import { classify } from './classifier.js';
import {
  BATCH_SIZE,
  type Config,
  ERROR_CATEGORIES,
  ERROR_EVENT_PREFIX,
  INTENT_CATEGORIES,
  TRACES_ENVIRONMENT,
} from './config.js';
import { print as printCost, reset as resetCost } from './cost-tracker.js';
import { type EvalContext, type Evaluator } from './evaluator.js';
import { classify as classifyIntent } from './intent-classifier.js';
import {
  createScore,
  type LangfuseCredentials,
  type LangfuseObservation,
  type LangfuseTrace,
  listObservations,
  listTraces,
} from './langfuse-client.js';

export interface ErrorEvent {
  traceId: string;
  traceSessionId?: string;
  observationId: string;
  observationName: string;
  errorMessage: string;
  metadata: Record<string, unknown>;
}

export interface ClassifiedEvent extends ErrorEvent {
  category: string;
  reasoning: string;
  confidence: number;
}

export interface PipelineOptions {
  sessions?: string[];
  hours?: number;
  workers: number;
}

export interface SessionData {
  messages: string[];
  traceIds: string[];
}

export interface IntentResult {
  sessionId: string;
  traceCount: number;
  messageCount: number;
  traceIds: string[];
  primaryCategory: string;
  primaryConfidence: number;
  secondaryCategory: string | null;
  secondaryConfidence: number;
  reasoning: string;
}

// -- Trace fetching --

export async function fetchTraces(
  creds: LangfuseCredentials,
  options: { sessions?: string[]; hours?: number }
): Promise<LangfuseTrace[]> {
  const allTraces: LangfuseTrace[] = [];
  const fromTimestamp = options.hours
    ? new Date(Date.now() - options.hours * 3600_000).toISOString()
    : undefined;

  if (options.sessions?.length) {
    for (const sessionId of options.sessions) {
      let page = 1;
      while (true) {
        const result = await listTraces(creds, {
          sessionId,
          fromTimestamp,
          environment: TRACES_ENVIRONMENT,
          page,
          limit: BATCH_SIZE,
        });
        if (!result.data.length) break;
        allTraces.push(...result.data);
        if (result.data.length < BATCH_SIZE) break;
        page++;
      }
    }
  } else {
    let page = 1;
    while (true) {
      const result = await listTraces(creds, {
        fromTimestamp,
        environment: TRACES_ENVIRONMENT,
        page,
        limit: BATCH_SIZE,
      });
      if (!result.data.length) break;
      allTraces.push(...result.data);
      if (result.data.length < BATCH_SIZE) break;
      page++;
    }
  }

  return allTraces;
}

// -- Shared concurrency helper --

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Error classification evaluator
// ---------------------------------------------------------------------------

function parseMetadata(obs: LangfuseObservation): Record<string, unknown> {
  if (obs.metadata == null) return {};
  if (typeof obs.metadata === 'object') return obs.metadata as Record<string, unknown>;
  if (typeof obs.metadata === 'string') {
    try { return JSON.parse(obs.metadata); } catch { return { _raw: obs.metadata }; }
  }
  return {};
}

function extractErrorMessage(meta: Record<string, unknown>): string {
  const err = meta['error'];
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') return (err as Record<string, string>)['message'] ?? '';
  return '';
}

async function scanTrace(
  creds: LangfuseCredentials,
  trace: LangfuseTrace
): Promise<ErrorEvent[]> {
  const events: ErrorEvent[] = [];
  let page = 1;

  while (true) {
    const result = await listObservations(creds, {
      traceId: trace.id,
      type: 'EVENT',
      page,
      limit: 100,
    });
    if (!result.data.length) break;

    for (const obs of result.data) {
      const name = obs.name ?? '';
      if (!name.startsWith(ERROR_EVENT_PREFIX)) continue;

      const meta = parseMetadata(obs);
      events.push({
        traceId: trace.id,
        traceSessionId: trace.sessionId,
        observationId: obs.id,
        observationName: name,
        errorMessage: extractErrorMessage(meta),
        metadata: meta,
      });
    }

    if (result.data.length < 100) break;
    page++;
  }

  return events;
}

export async function extractErrorEvents(
  creds: LangfuseCredentials,
  traces: LangfuseTrace[],
  workers: number
): Promise<ErrorEvent[]> {
  const batchResults = await runWithConcurrency(traces, workers, async function scan(trace) {
    return scanTrace(creds, trace);
  });

  const allEvents: ErrorEvent[] = [];
  for (const events of batchResults) {
    allEvents.push(...events);
  }
  return allEvents;
}

export async function classifyAndScore(
  creds: LangfuseCredentials,
  config: Config,
  errorEvents: ErrorEvent[],
  workers: number
): Promise<ClassifiedEvent[]> {
  const results = await runWithConcurrency(errorEvents, workers, async function classifySingle(ev) {
    const classification = await classify(ev.errorMessage, config.llm);

    await Promise.all([
      createScore(creds, {
        traceId: ev.traceId,
        observationId: ev.observationId,
        name: 'error_category',
        value: classification.category,
        dataType: 'CATEGORICAL',
        comment: classification.reasoning,
        id: `${ev.observationId}-error_category`,
      }),
      createScore(creds, {
        traceId: ev.traceId,
        observationId: ev.observationId,
        name: 'error_category_confidence',
        value: classification.confidence,
        dataType: 'NUMERIC',
        comment: classification.reasoning,
        id: `${ev.observationId}-error_category_confidence`,
      }),
    ]);

    return {
      ...ev,
      errorMessage: ev.errorMessage.slice(0, 300),
      ...classification,
    };
  });

  const byTrace = new Map<string, ClassifiedEvent[]>();
  for (const r of results) {
    const list = byTrace.get(r.traceId) ?? [];
    list.push(r);
    byTrace.set(r.traceId, list);
  }

  for (const [traceId, traceResults] of byTrace) {
    const errorCount = traceResults.length;

    const categoryCounts = new Map<string, number>();
    for (const r of traceResults) {
      categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
    }
    let primaryCategory = 'other';
    let maxCount = 0;
    for (const [cat, count] of categoryCounts) {
      if (count > maxCount) {
        maxCount = count;
        primaryCategory = cat;
      }
    }

    await Promise.all([
      createScore(creds, {
        traceId,
        name: 'error_count',
        value: errorCount,
        dataType: 'NUMERIC',
        comment: `${errorCount} agent_error_trace event(s) in this trace`,
        id: `${traceId}-error_count`,
      }),
      createScore(creds, {
        traceId,
        name: 'primary_error_category',
        value: primaryCategory,
        dataType: 'CATEGORICAL',
        comment: `Most frequent error category across ${errorCount} error event(s)`,
        id: `${traceId}-primary_error_category`,
      }),
    ]);
  }

  return results;
}

export function formatErrorReport(results: ClassifiedEvent[], langfuseBaseUrl: string): string {
  if (!results.length) return '  No error events found.';

  const lines: string[] = [];
  const total = results.length;
  const tracesWithErrors = new Set(results.map(r => r.traceId)).size;
  const categoryCounts = new Map<string, number>();
  const byCategory = new Map<string, ClassifiedEvent[]>();
  for (const r of results) {
    categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }
  const lowConfidence = results.filter(r => r.confidence < 0.7);

  const sep = '='.repeat(72);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  lines.push(`\n${sep}`);
  lines.push(`  TOOL FAILURE ANALYSIS REPORT -- ${now}`);
  lines.push(sep);
  lines.push(`\n  Error events classified:   ${total}`);
  lines.push(`  Traces with errors:        ${tracesWithErrors}\n`);
  lines.push('  Category Distribution:');
  lines.push(`  ${'-'.repeat(55)}`);

  for (const cat of ERROR_CATEGORIES) {
    const count = categoryCounts.get(cat) ?? 0;
    const pct = total ? (count / total) * 100 : 0;
    const bar = '#'.repeat(Math.floor(pct / 2));
    lines.push(`  ${cat.padEnd(30)} ${String(count).padStart(5)}  (${pct.toFixed(1).padStart(5)}%)  ${bar}`);
  }
  lines.push(`  ${'-'.repeat(55)}`);

  for (const cat of ERROR_CATEGORIES) {
    const tracesInCat = byCategory.get(cat);
    if (!tracesInCat?.length) continue;

    lines.push(`\n  [${cat}] -- Top error messages:`);
    const msgCounts = new Map<string, number>();
    for (const r of tracesInCat) {
      const key = r.errorMessage.slice(0, 120).replace(/\n/g, ' ');
      msgCounts.set(key, (msgCounts.get(key) ?? 0) + 1);
    }
    const sorted = [...msgCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [msg, cnt] of sorted) {
      lines.push(`    (${cnt}x) ${msg}`);
    }
    const sample = tracesInCat[0];
    lines.push(`  Sample: ${langfuseBaseUrl}/trace/${sample.traceId}?observation=${sample.observationId}`);
  }

  if (lowConfidence.length) {
    lines.push(`\n  Low-confidence classifications (${lowConfidence.length}):`);
    for (const r of lowConfidence.slice(0, 10)) {
      lines.push(`    [${r.confidence.toFixed(2)}] ${r.category.padEnd(28)} ${langfuseBaseUrl}/trace/${r.traceId}`);
    }
    if (lowConfidence.length > 10) {
      lines.push(`    ... and ${lowConfidence.length - 10} more`);
    }
  }

  lines.push(`\n${sep}`);
  return lines.join('\n');
}

export const errorEvaluator: Evaluator = {
  name: 'error',
  async run(ctx: EvalContext): Promise<string> {
    const errorEvents = await extractErrorEvents(ctx.creds, ctx.traces, ctx.workers);
    if (!errorEvents.length) return '  No error events found.';

    const results = await classifyAndScore(ctx.creds, ctx.config, errorEvents, ctx.workers);
    return formatErrorReport(results, ctx.creds.baseUrl);
  },
};

// ---------------------------------------------------------------------------
// Intent classification evaluator
// ---------------------------------------------------------------------------

export interface SessionGroupResult {
  sessions: Map<string, LangfuseTrace[]>;
  skipped: number;
}

export function groupBySession(traces: LangfuseTrace[]): SessionGroupResult {
  const sessions = new Map<string, LangfuseTrace[]>();
  let skipped = 0;

  for (const trace of traces) {
    if (!trace.sessionId) {
      skipped++;
      continue;
    }
    const list = sessions.get(trace.sessionId) ?? [];
    list.push(trace);
    sessions.set(trace.sessionId, list);
  }

  return { sessions, skipped };
}

function extractInputText(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === 'string') return input.trim() || null;
  if (typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    for (const key of ['message', 'query', 'prompt', 'input', 'text', 'content']) {
      if (key in record && typeof record[key] === 'string') {
        const text = (record[key] as string).trim();
        if (text) return text;
      }
    }
    return JSON.stringify(input).slice(0, 500);
  }
  return null;
}

export function extractSessionInputs(
  sessions: Map<string, LangfuseTrace[]>
): Map<string, SessionData> {
  const result = new Map<string, SessionData>();

  for (const [sessionId, traces] of sessions) {
    const messages: string[] = [];
    const traceIds: string[] = [];

    for (const trace of traces) {
      traceIds.push(trace.id);
      const text = extractInputText(trace.input);
      if (text) messages.push(text);
    }

    result.set(sessionId, { messages, traceIds });
  }

  return result;
}

export async function classifyAndScoreIntents(
  creds: LangfuseCredentials,
  config: Config,
  sessionInputs: Map<string, SessionData>,
  workers: number
): Promise<IntentResult[]> {
  const entries = [...sessionInputs.entries()];

  return runWithConcurrency(entries, workers, async function classifySession(
    [sessionId, data]
  ) {
    try {
      const classification = await classifyIntent(data.messages, config.llm);

      const scores: Promise<void>[] = [
        createScore(creds, {
          sessionId,
          name: 'intent_primary_category',
          value: classification.primaryCategory,
          dataType: 'CATEGORICAL',
          comment: classification.reasoning,
          id: `${sessionId}-intent_primary_category`,
        }),
        createScore(creds, {
          sessionId,
          name: 'intent_primary_confidence',
          value: classification.primaryConfidence,
          dataType: 'NUMERIC',
          comment: classification.reasoning,
          id: `${sessionId}-intent_primary_confidence`,
        }),
      ];

      if (classification.secondaryCategory) {
        scores.push(
          createScore(creds, {
            sessionId,
            name: 'intent_secondary_category',
            value: classification.secondaryCategory,
            dataType: 'CATEGORICAL',
            comment: classification.reasoning,
            id: `${sessionId}-intent_secondary_category`,
          }),
          createScore(creds, {
            sessionId,
            name: 'intent_secondary_confidence',
            value: classification.secondaryConfidence,
            dataType: 'NUMERIC',
            comment: classification.reasoning,
            id: `${sessionId}-intent_secondary_confidence`,
          }),
        );
      }

      await Promise.all(scores);

      return {
        sessionId,
        traceCount: data.traceIds.length,
        messageCount: data.messages.length,
        traceIds: data.traceIds,
        ...classification,
      };
    } catch (error) {
      return {
        sessionId,
        traceCount: data.traceIds.length,
        messageCount: data.messages.length,
        traceIds: data.traceIds,
        primaryCategory: 'other' as const,
        primaryConfidence: 0.0,
        secondaryCategory: null,
        secondaryConfidence: 0.0,
        reasoning: `Classification failed: ${String(error).slice(0, 200)}`,
      };
    }
  });
}

export function formatIntentReport(results: IntentResult[], langfuseBaseUrl: string): string {
  if (!results.length) return '  No sessions to classify.';

  const lines: string[] = [];
  const total = results.length;
  const totalTraces = results.reduce(function sum(acc, r) { return acc + r.traceCount; }, 0);
  const sessionsWithSecondary = results.filter(function hasSecondary(r) { return r.secondaryCategory != null; }).length;
  const failed = results.filter(function isFailed(r) { return r.primaryConfidence === 0.0 && r.primaryCategory === 'other'; }).length;

  const primaryCounts = new Map<string, number>();
  const secondaryCounts = new Map<string, number>();
  const byPrimary = new Map<string, IntentResult[]>();
  for (const r of results) {
    primaryCounts.set(r.primaryCategory, (primaryCounts.get(r.primaryCategory) ?? 0) + 1);
    const list = byPrimary.get(r.primaryCategory) ?? [];
    list.push(r);
    byPrimary.set(r.primaryCategory, list);
    if (r.secondaryCategory) {
      secondaryCounts.set(r.secondaryCategory, (secondaryCounts.get(r.secondaryCategory) ?? 0) + 1);
    }
  }
  const lowConfidence = results.filter(function low(r) { return r.primaryConfidence < 0.7; });

  const sep = '='.repeat(72);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  lines.push(`\n${sep}`);
  lines.push(`  INTENT CLASSIFICATION REPORT -- ${now}`);
  lines.push(sep);
  lines.push(`\n  Sessions classified:       ${total}`);
  lines.push(`  Total traces in sessions:  ${totalTraces}`);
  lines.push(`  Sessions with secondary:   ${sessionsWithSecondary}`);
  if (failed) lines.push(`  Classification failures:   ${failed}`);

  lines.push('\n  Primary Intent Distribution:');
  lines.push(`  ${'-'.repeat(55)}`);
  for (const cat of INTENT_CATEGORIES) {
    const count = primaryCounts.get(cat) ?? 0;
    const pct = total ? (count / total) * 100 : 0;
    const bar = '#'.repeat(Math.floor(pct / 2));
    lines.push(`  ${cat.padEnd(25)} ${String(count).padStart(5)}  (${pct.toFixed(1).padStart(5)}%)  ${bar}`);
  }
  lines.push(`  ${'-'.repeat(55)}`);

  if (sessionsWithSecondary) {
    lines.push('\n  Secondary Intent Distribution:');
    lines.push(`  ${'-'.repeat(55)}`);
    for (const cat of INTENT_CATEGORIES) {
      const count = secondaryCounts.get(cat) ?? 0;
      if (!count) continue;
      const pct = (count / sessionsWithSecondary) * 100;
      const bar = '#'.repeat(Math.floor(pct / 2));
      lines.push(`  ${cat.padEnd(25)} ${String(count).padStart(5)}  (${pct.toFixed(1).padStart(5)}%)  ${bar}`);
    }
    lines.push(`  ${'-'.repeat(55)}`);
  }

  for (const cat of INTENT_CATEGORIES) {
    const sessionsInCat = byPrimary.get(cat);
    if (!sessionsInCat?.length) continue;

    lines.push(`\n  [${cat}] -- Sample sessions:`);
    for (const r of sessionsInCat.slice(0, 3)) {
      const secondary = r.secondaryCategory ? `, secondary=${r.secondaryCategory}` : '';
      lines.push(`    Session: ${r.sessionId.slice(0, 40)}  (${r.messageCount} msgs, ${r.traceCount} traces, conf=${r.primaryConfidence.toFixed(2)}${secondary})`);
      lines.push(`      Reasoning: ${r.reasoning.slice(0, 120)}`);
      if (r.traceIds.length) {
        lines.push(`      Link: ${langfuseBaseUrl}/trace/${r.traceIds[0]}`);
      }
    }
  }

  if (lowConfidence.length) {
    lines.push(`\n  Low-confidence primary classifications (${lowConfidence.length}):`);
    for (const r of lowConfidence.slice(0, 10)) {
      lines.push(`    [${r.primaryConfidence.toFixed(2)}] ${r.primaryCategory.padEnd(25)} session=${r.sessionId.slice(0, 30)}`);
    }
    if (lowConfidence.length > 10) {
      lines.push(`    ... and ${lowConfidence.length - 10} more`);
    }
  }

  lines.push(`\n${sep}`);
  return lines.join('\n');
}

export const intentEvaluator: Evaluator = {
  name: 'intent',
  async run(ctx: EvalContext): Promise<string> {
    const { sessions } = groupBySession(ctx.traces);
    const sessionInputs = extractSessionInputs(sessions);
    const results = await classifyAndScoreIntents(ctx.creds, ctx.config, sessionInputs, ctx.workers);
    return formatIntentReport(results, ctx.creds.baseUrl);
  },
};

// ---------------------------------------------------------------------------
// Evaluator registry
// ---------------------------------------------------------------------------

export const EVALUATORS: Evaluator[] = [errorEvaluator, intentEvaluator];

export function findEvaluators(names: string[]): Evaluator[] {
  return names.map(function find(name) {
    const match = EVALUATORS.find(function match(e) { return e.name === name; });
    if (!match) throw new Error(`Unknown evaluator: "${name}". Available: ${EVALUATORS.map(e => e.name).join(', ')}`);
    return match;
  });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function formatScope(options: PipelineOptions): string {
  const parts: string[] = [];
  if (options.sessions?.length) {
    parts.push(`sessions: ${options.sessions.map(function truncate(s) { return s.slice(0, 12) + '...'; }).join(', ')}`);
  }
  if (options.hours) {
    parts.push(`last ${options.hours}h`);
  }
  return parts.join(', ');
}

export async function runAll(config: Config, options: PipelineOptions, evaluators?: Evaluator[]): Promise<void> {
  resetCost();
  const creds: LangfuseCredentials = config.langfuse;
  const selected = evaluators ?? EVALUATORS;

  const traces = await fetchTraces(creds, { sessions: options.sessions, hours: options.hours });
  const sessionCount = new Set(traces.map(t => t.sessionId).filter(Boolean)).size;

  console.log(`Scope: ${formatScope(options)}`);
  console.log(`Traces: ${traces.length}, Sessions: ${sessionCount}`);
  console.log(`Evaluators: ${selected.map(e => e.name).join(', ')}`);

  if (!traces.length) {
    console.log('No traces found. Exiting.');
    return;
  }

  const ctx: EvalContext = { creds, config, traces, workers: options.workers };

  let reports: string[];
  if (selected.length === 1) {
    reports = [await selected[0].run(ctx)];
  } else {
    reports = await Promise.all(selected.map(function execute(evaluator) {
      return evaluator.run(ctx);
    }));
  }

  for (const report of reports) {
    console.log(report);
  }

  printCost();
}

// Backward-compatible thin wrappers

export async function run(config: Config, options: PipelineOptions): Promise<void> {
  await runAll(config, options, [errorEvaluator]);
}

export async function runIntent(config: Config, options: PipelineOptions): Promise<void> {
  await runAll(config, options, [intentEvaluator]);
}

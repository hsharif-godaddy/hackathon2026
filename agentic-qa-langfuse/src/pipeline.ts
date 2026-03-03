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

export interface IntentPipelineOptions {
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

// -- Step A: Fetch traces --

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
        console.log(`  Session ${sessionId.slice(0, 12)}... page ${page}, ${result.data.length} traces`);
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
      console.log(`  Page ${page} -- ${result.data.length} traces`);
      if (result.data.length < BATCH_SIZE) break;
      page++;
    }
  }

  return allTraces;
}

// -- Observation scanning --

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

export async function extractErrorEvents(
  creds: LangfuseCredentials,
  traces: LangfuseTrace[],
  workers: number
): Promise<ErrorEvent[]> {
  let scanned = 0;
  const allEvents: ErrorEvent[] = [];

  const batchResults = await runWithConcurrency(traces, workers, async function scan(trace) {
    const events = await scanTrace(creds, trace);
    scanned++;
    if (scanned % 50 === 0 || scanned === traces.length) {
      console.log(`  Scanned ${scanned}/${traces.length} traces, ${allEvents.length + events.length} error events so far`);
    }
    return events;
  });

  for (const events of batchResults) {
    allEvents.push(...events);
  }

  return allEvents;
}

// -- Step B: Classify and score --

export async function classifyAndScore(
  creds: LangfuseCredentials,
  config: Config,
  errorEvents: ErrorEvent[],
  workers: number
): Promise<ClassifiedEvent[]> {
  let classified = 0;

  const results = await runWithConcurrency(errorEvents, workers, async function classifySingle(ev) {
    const classification = await classify(ev.errorMessage, config.llm);

    await createScore(creds, {
      traceId: ev.traceId,
      observationId: ev.observationId,
      name: 'error_category',
      value: classification.category,
      dataType: 'CATEGORICAL',
      comment: classification.reasoning,
      id: `${ev.observationId}-error_category`,
    });

    await createScore(creds, {
      traceId: ev.traceId,
      observationId: ev.observationId,
      name: 'error_category_confidence',
      value: classification.confidence,
      dataType: 'NUMERIC',
      comment: classification.reasoning,
      id: `${ev.observationId}-error_category_confidence`,
    });

    classified++;
    if (classified % 10 === 0 || classified === errorEvents.length) {
      console.log(`  Classified ${classified}/${errorEvents.length} error events`);
    }

    return {
      ...ev,
      errorMessage: ev.errorMessage.slice(0, 300),
      ...classification,
    };
  });

  // Trace-level summary scores
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

    await createScore(creds, {
      traceId,
      name: 'error_count',
      value: errorCount,
      dataType: 'NUMERIC',
      comment: `${errorCount} agent_error_trace event(s) in this trace`,
      id: `${traceId}-error_count`,
    });

    await createScore(creds, {
      traceId,
      name: 'primary_error_category',
      value: primaryCategory,
      dataType: 'CATEGORICAL',
      comment: `Most frequent error category across ${errorCount} error event(s)`,
      id: `${traceId}-primary_error_category`,
    });
  }

  return results;
}

// -- Step C: Report --

export function printReport(results: ClassifiedEvent[], langfuseBaseUrl: string): void {
  const total = results.length;
  if (total === 0) {
    console.log('\nNo error events found.');
    return;
  }

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

  console.log(`\n${sep}`);
  console.log(`  TOOL FAILURE ANALYSIS REPORT -- ${now}`);
  console.log(sep);
  console.log(`\n  Error events classified:   ${total}`);
  console.log(`  Traces with errors:        ${tracesWithErrors}\n`);
  console.log('  Category Distribution:');
  console.log(`  ${'-'.repeat(55)}`);

  for (const cat of ERROR_CATEGORIES) {
    const count = categoryCounts.get(cat) ?? 0;
    const pct = total ? (count / total) * 100 : 0;
    const bar = '#'.repeat(Math.floor(pct / 2));
    console.log(`  ${cat.padEnd(30)} ${String(count).padStart(5)}  (${pct.toFixed(1).padStart(5)}%)  ${bar}`);
  }
  console.log(`  ${'-'.repeat(55)}`);

  for (const cat of ERROR_CATEGORIES) {
    const tracesInCat = byCategory.get(cat);
    if (!tracesInCat?.length) continue;

    console.log(`\n  [${cat}] -- Top error messages:`);
    const msgCounts = new Map<string, number>();
    for (const r of tracesInCat) {
      const key = r.errorMessage.slice(0, 120).replace(/\n/g, ' ');
      msgCounts.set(key, (msgCounts.get(key) ?? 0) + 1);
    }
    const sorted = [...msgCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [msg, cnt] of sorted) {
      console.log(`    (${cnt}x) ${msg}`);
    }
    const sample = tracesInCat[0];
    console.log(`  Sample: ${langfuseBaseUrl}/trace/${sample.traceId}?observation=${sample.observationId}`);
  }

  if (lowConfidence.length) {
    console.log(`\n  Low-confidence classifications (${lowConfidence.length}):`);
    for (const r of lowConfidence.slice(0, 10)) {
      console.log(`    [${r.confidence.toFixed(2)}] ${r.category.padEnd(28)} ${langfuseBaseUrl}/trace/${r.traceId}`);
    }
    if (lowConfidence.length > 10) {
      console.log(`    ... and ${lowConfidence.length - 10} more`);
    }
  }

  console.log(`\n${sep}`);
}

// -- Main entry --

export async function run(config: Config, options: PipelineOptions): Promise<void> {
  resetCost();
  const creds: LangfuseCredentials = config.langfuse;

  const scopeParts: string[] = [];
  if (options.sessions?.length) {
    scopeParts.push(`sessions: ${options.sessions.map(s => s.slice(0, 12) + '...').join(', ')}`);
  }
  if (options.hours) {
    scopeParts.push(`last ${options.hours}h`);
  }

  console.log(`Step 1: Fetching traces (${scopeParts.join(', ')})...`);
  const traces = await fetchTraces(creds, { sessions: options.sessions, hours: options.hours });
  console.log(`  -> ${traces.length} traces found.\n`);

  if (!traces.length) {
    console.log('No traces found. Exiting.');
    return;
  }

  console.log(`Step 2: Scanning observations (${options.workers} workers)...`);
  const t0 = Date.now();
  const errorEvents = await extractErrorEvents(creds, traces, options.workers);
  console.log(`  -> ${errorEvents.length} error events found in ${((Date.now() - t0) / 1000).toFixed(1)}s.\n`);

  if (!errorEvents.length) {
    console.log('No error events found in these traces. Exiting.');
    return;
  }

  console.log(`Step 3: Classifying errors (${options.workers} workers)...`);
  const t1 = Date.now();
  const results = await classifyAndScore(creds, config, errorEvents, options.workers);
  console.log(`  -> Classification done in ${((Date.now() - t1) / 1000).toFixed(1)}s.\n`);

  console.log('Step 4: Generating report...');
  printReport(results, creds.baseUrl);
  printCost();
}

// ---------------------------------------------------------------------------
// Intent classification pipeline
// ---------------------------------------------------------------------------

export function groupBySession(traces: LangfuseTrace[]): Map<string, LangfuseTrace[]> {
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

  if (skipped) {
    console.log(`  Warning: ${skipped} trace(s) have no sessionId and were skipped.`);
  }

  return sessions;
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
  let classified = 0;
  const entries = [...sessionInputs.entries()];
  const total = entries.length;

  const results = await runWithConcurrency(entries, workers, async function classifySession(
    [sessionId, data]
  ) {
    let result: IntentResult;
    try {
      const classification = await classifyIntent(data.messages, config.llm);

      await createScore(creds, {
        sessionId,
        name: 'intent_primary_category',
        value: classification.primaryCategory,
        dataType: 'CATEGORICAL',
        comment: classification.reasoning,
        id: `${sessionId}-intent_primary_category`,
      });

      await createScore(creds, {
        sessionId,
        name: 'intent_primary_confidence',
        value: classification.primaryConfidence,
        dataType: 'NUMERIC',
        comment: classification.reasoning,
        id: `${sessionId}-intent_primary_confidence`,
      });

      if (classification.secondaryCategory) {
        await createScore(creds, {
          sessionId,
          name: 'intent_secondary_category',
          value: classification.secondaryCategory,
          dataType: 'CATEGORICAL',
          comment: classification.reasoning,
          id: `${sessionId}-intent_secondary_category`,
        });

        await createScore(creds, {
          sessionId,
          name: 'intent_secondary_confidence',
          value: classification.secondaryConfidence,
          dataType: 'NUMERIC',
          comment: classification.reasoning,
          id: `${sessionId}-intent_secondary_confidence`,
        });
      }

      result = {
        sessionId,
        traceCount: data.traceIds.length,
        messageCount: data.messages.length,
        traceIds: data.traceIds,
        ...classification,
      };
    } catch (error) {
      console.log(`  ERROR classifying session ${sessionId.slice(0, 30)}: ${error instanceof Error ? error.message : String(error)}`);
      result = {
        sessionId,
        traceCount: data.traceIds.length,
        messageCount: data.messages.length,
        traceIds: data.traceIds,
        primaryCategory: 'other',
        primaryConfidence: 0.0,
        secondaryCategory: null,
        secondaryConfidence: 0.0,
        reasoning: `Classification failed: ${String(error).slice(0, 200)}`,
      };
    }

    classified++;
    if (classified % 10 === 0 || classified === total) {
      console.log(`  Classified ${classified}/${total} sessions`);
    }

    return result;
  });

  return results;
}

export function printIntentReport(results: IntentResult[], langfuseBaseUrl: string): void {
  const total = results.length;
  if (total === 0) {
    console.log('\nNo sessions to classify.');
    return;
  }

  const totalTraces = results.reduce(function sum(acc, r) { return acc + r.traceCount; }, 0);
  const sessionsWithSecondary = results.filter(function hasSecondary(r) { return r.secondaryCategory != null; }).length;

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

  console.log(`\n${sep}`);
  console.log(`  INTENT CLASSIFICATION REPORT -- ${now}`);
  console.log(sep);
  console.log(`\n  Sessions classified:       ${total}`);
  console.log(`  Total traces in sessions:  ${totalTraces}`);
  console.log(`  Sessions with secondary:   ${sessionsWithSecondary}\n`);

  console.log('  Primary Intent Distribution:');
  console.log(`  ${'-'.repeat(55)}`);
  for (const cat of INTENT_CATEGORIES) {
    const count = primaryCounts.get(cat) ?? 0;
    const pct = total ? (count / total) * 100 : 0;
    const bar = '#'.repeat(Math.floor(pct / 2));
    console.log(`  ${cat.padEnd(25)} ${String(count).padStart(5)}  (${pct.toFixed(1).padStart(5)}%)  ${bar}`);
  }
  console.log(`  ${'-'.repeat(55)}`);

  if (sessionsWithSecondary) {
    console.log('\n  Secondary Intent Distribution:');
    console.log(`  ${'-'.repeat(55)}`);
    for (const cat of INTENT_CATEGORIES) {
      const count = secondaryCounts.get(cat) ?? 0;
      if (!count) continue;
      const pct = (count / sessionsWithSecondary) * 100;
      const bar = '#'.repeat(Math.floor(pct / 2));
      console.log(`  ${cat.padEnd(25)} ${String(count).padStart(5)}  (${pct.toFixed(1).padStart(5)}%)  ${bar}`);
    }
    console.log(`  ${'-'.repeat(55)}`);
  }

  for (const cat of INTENT_CATEGORIES) {
    const sessionsInCat = byPrimary.get(cat);
    if (!sessionsInCat?.length) continue;

    console.log(`\n  [${cat}] -- Sample sessions:`);
    for (const r of sessionsInCat.slice(0, 3)) {
      const secondary = r.secondaryCategory ? `, secondary=${r.secondaryCategory}` : '';
      console.log(`    Session: ${r.sessionId.slice(0, 40)}  (${r.messageCount} msgs, ${r.traceCount} traces, conf=${r.primaryConfidence.toFixed(2)}${secondary})`);
      console.log(`      Reasoning: ${r.reasoning.slice(0, 120)}`);
      if (r.traceIds.length) {
        console.log(`      Link: ${langfuseBaseUrl}/trace/${r.traceIds[0]}`);
      }
    }
  }

  if (lowConfidence.length) {
    console.log(`\n  Low-confidence primary classifications (${lowConfidence.length}):`);
    for (const r of lowConfidence.slice(0, 10)) {
      console.log(`    [${r.primaryConfidence.toFixed(2)}] ${r.primaryCategory.padEnd(25)} session=${r.sessionId.slice(0, 30)}`);
    }
    if (lowConfidence.length > 10) {
      console.log(`    ... and ${lowConfidence.length - 10} more`);
    }
  }

  console.log(`\n${sep}`);
}

export async function runIntent(config: Config, options: IntentPipelineOptions): Promise<void> {
  resetCost();
  const creds: LangfuseCredentials = config.langfuse;

  const scopeParts: string[] = [];
  if (options.sessions?.length) {
    scopeParts.push(`sessions: ${options.sessions.map(function truncate(s) { return s.slice(0, 12) + '...'; }).join(', ')}`);
  }
  if (options.hours) {
    scopeParts.push(`last ${options.hours}h`);
  }

  console.log(`Step 1: Fetching traces (${scopeParts.join(', ')}) [mode=intent]...`);
  const traces = await fetchTraces(creds, { sessions: options.sessions, hours: options.hours });
  console.log(`  -> ${traces.length} traces found.\n`);

  if (!traces.length) {
    console.log('No traces found. Exiting.');
    return;
  }

  console.log('Step 2: Grouping traces by session...');
  const sessions = groupBySession(traces);
  console.log(`  -> ${sessions.size} sessions found.\n`);

  console.log('Step 3: Extracting user inputs per session...');
  const sessionInputs = extractSessionInputs(sessions);
  let sessionsWithMessages = 0;
  for (const data of sessionInputs.values()) {
    if (data.messages.length) sessionsWithMessages++;
  }
  console.log(`  -> ${sessionsWithMessages}/${sessionInputs.size} sessions have user messages.\n`);

  console.log(`Step 4: Classifying intents (${options.workers} workers)...`);
  const t0 = Date.now();
  const results = await classifyAndScoreIntents(creds, config, sessionInputs, options.workers);
  console.log(`  -> Classification done in ${((Date.now() - t0) / 1000).toFixed(1)}s.\n`);

  console.log('Step 5: Generating intent report...');
  printIntentReport(results, creds.baseUrl);
  printCost();
}

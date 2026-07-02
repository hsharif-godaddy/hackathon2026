import { loadConfig } from './config.js';
import { makeReadClient, makeWriteClient } from './es-clients.js';
import { ensureStatsIndex } from './bootstrap.js';
import { collectHour } from './collector.js';
import { collectApm } from './apm-collector.js';
import { collectCloudwatch } from './cloudwatch-collector.js';
import { collectAgentsApm } from './agents-apm-collector.js';
import { collectAgentsTraces } from './agents-traces-collector.js';
import { collectAgentsLogs } from './agents-log-collector.js';
import { collectLoki } from './loki-collector.js';
import { buildStatsDoc, writeStatsDoc } from './writer.js';
import {
  loadBaselines,
  loadRecentRows,
  loadRecentDailyNotes,
  loadRecentDailyStats,
  loadEventNameBaseline,
  detectSeries,
  detectTrends,
  type Candidate,
} from './detector.js';
import { buildDigestBlocks, postSlack } from './reporter.js';
import { hourWindow } from './windows.js';
import { aggregateDay } from './aggregate.js';
import { getGocodeJwt } from './gocode-auth.js';
import { runLlmReasoner, type Verdict } from './llm-reasoner.js';

export interface WatchtowerEvent { mode: 'daily' | 'tripwire' }
export interface HandlerResult { ok: boolean; mode: string; posted?: boolean; verdict?: string }

const SEVERITY_ORDER: Record<'P1' | 'P2' | 'P3', number> = { P1: 3, P2: 2, P3: 1 };

// Merge z-score candidates with trend candidates.
// Per stat, keep highest severity; when tied, prefer trend candidate (more
// informative for escalating incidents where baseline is contaminated).
function mergeCandidates(series: Candidate[], trends: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const c of [...series, ...trends]) {
    const key = String(c.stat);
    const prev = map.get(key);
    if (
      !prev ||
      SEVERITY_ORDER[c.severity] > SEVERITY_ORDER[prev.severity] ||
      (c.severity === prev.severity && c.trend_streak != null)
    ) {
      map.set(key, c);
    }
  }
  return [...map.values()];
}

const EMPTY_APM = { req_throughput: 0, req_error_rate: 0, latency_p50_ms: 0, latency_p95_ms: 0 };
const EMPTY_CW  = { alb_5xx_count: 0, alb_req_count: 0, alb_p95_ms: 0 };
const EMPTY_AGENTS_APM = { agents_http_throughput: 0, agents_http_error_rate: 0, agents_http_p95_ms: 0, agents_chat_throughput: 0, agents_chat_p95_ms: 0, agents_publish_count: 0 };
const EMPTY_AGENTS_TRACES = { agents_invocation_count: 0, agents_invocation_failure_count: 0, agents_invocation_abort_count: 0, agents_invocation_fetch_fail_count: 0, agents_toolcall_count: 0, agents_outbound_timeout_count: 0, agentToolNames: [] as string[] };
const EMPTY_AGENTS_LOGS = { agents_ai_call_count: 0, agents_http_error_count: 0, agents_auth_failure_count: 0, agents_embedding_error_count: 0 };
const EMPTY_LOKI = { agent_run_count: 0, tool_failure_count: 0, skill_activation_failure_count: 0, typecheck_failure_count: 0, budget_exhaustion_count: 0, sse_error_count: 0, agent_publish_failure_count: 0, preview_http_5xx_count: 0, preview_http_502_count: 0, preview_http_401_count: 0, publish_http_5xx_count: 0, failedSkillNames: [] as string[], topToolNames: [] as string[] };

export async function handler(event: WatchtowerEvent): Promise<HandlerResult> {
  const cfg = await loadConfig(process.env);
  const readClient = makeReadClient(cfg.esRead);
  const writeClient = makeWriteClient(cfg.esWrite);

  await ensureStatsIndex(writeClient, cfg.statsIndex);

  if (event.mode === 'tripwire') {
    const { startIso, endIso } = hourWindow(Date.now());

    // Use allSettled so a flaky APM/CloudWatch query doesn't abort the whole
    // hourly run and lose the app-log row. On failure: warn + degrade to zeros
    // only for stats where 0 is safe (context-only). Higher-is-bad stats stay
    // at 0 as well but that's acceptable for a single missed hour — the next
    // run fills in fresh values and the baseline excludes the outlier.
    const endUnix = Math.floor(new Date(endIso).getTime() / 1000);
    const [appRes, apmRes, cwRes, agentsApmRes, agentsTracesRes, agentsLogsRes, lokiRes] = await Promise.allSettled([
      collectHour(readClient, cfg.appLogIndex, startIso, endIso),
      cfg.apmServiceName
        ? collectApm(readClient, cfg.apmIndex, cfg.apmServiceName, startIso, endIso)
        : Promise.resolve(EMPTY_APM),
      cfg.albLoadBalancerName
        ? collectCloudwatch(readClient, 'metrics-aws.cloudwatch*', cfg.albLoadBalancerName, startIso, endIso)
        : Promise.resolve(EMPTY_CW),
      collectAgentsApm(readClient, cfg.apmIndex, startIso, endIso),
      collectAgentsTraces(readClient, cfg.tracesIndex, startIso, endIso),
      cfg.agentsLogIndex
        ? collectAgentsLogs(readClient, cfg.agentsLogIndex, startIso, endIso)
        : Promise.resolve(EMPTY_AGENTS_LOGS),
      cfg.lokiEndpoint && cfg.lokiApiKey
        ? collectLoki(cfg.lokiEndpoint, cfg.lokiApiKey, cfg.lokiEnv, endUnix)
        : Promise.resolve(EMPTY_LOKI),
    ]);

    if (appRes.status === 'rejected') {
      console.error('watchtower.tripwire.collect.failed — skipping write', appRes.reason);
      return { ok: false, mode: 'tripwire' };
    }

    if (apmRes.status === 'rejected') {
      console.warn('watchtower.tripwire.apm.failed — writing zeros for APM stats', apmRes.reason);
    }
    if (cwRes.status === 'rejected') {
      console.warn('watchtower.tripwire.cloudwatch.failed — writing zeros for ALB stats', cwRes.reason);
    }
    if (agentsApmRes.status === 'rejected') {
      console.warn('watchtower.tripwire.agents_apm.failed — writing zeros', agentsApmRes.reason);
    }
    if (agentsTracesRes.status === 'rejected') {
      console.warn('watchtower.tripwire.agents_traces.failed — writing zeros', agentsTracesRes.reason);
    }
    if (agentsLogsRes.status === 'rejected') {
      console.warn('watchtower.tripwire.agents_logs.failed — writing zeros', agentsLogsRes.reason);
    }
    if (lokiRes.status === 'rejected') {
      console.warn('watchtower.tripwire.loki.failed — writing zeros for Loki stats', lokiRes.reason);
    }

    const apmStats         = apmRes.status         === 'fulfilled' ? apmRes.value         : EMPTY_APM;
    const cwStats          = cwRes.status          === 'fulfilled' ? cwRes.value          : EMPTY_CW;
    const agentsApmStats   = agentsApmRes.status   === 'fulfilled' ? agentsApmRes.value   : EMPTY_AGENTS_APM;
    const agentsTracesStats = agentsTracesRes.status === 'fulfilled' ? agentsTracesRes.value : EMPTY_AGENTS_TRACES;
    const agentsLogsStats  = agentsLogsRes.status  === 'fulfilled' ? agentsLogsRes.value  : EMPTY_AGENTS_LOGS;
    const lokiStats        = lokiRes.status        === 'fulfilled' ? lokiRes.value        : EMPTY_LOKI;
    const { data, errorEventNames } = appRes.value;

    const fingerprintBaseline = await loadEventNameBaseline(writeClient, cfg.statsIndex, 168);
    const newFingerprints = errorEventNames.filter((n) => !fingerprintBaseline.has(n));
    data.new_error_fingerprints = newFingerprints.length;

    data.req_throughput     = apmStats.req_throughput;
    data.req_error_rate     = apmStats.req_error_rate;
    data.latency_p50_ms     = apmStats.latency_p50_ms;
    data.latency_p95_ms     = apmStats.latency_p95_ms;
    data.alb_5xx_count      = cwStats.alb_5xx_count;
    data.alb_req_count      = cwStats.alb_req_count;
    data.alb_p95_ms         = cwStats.alb_p95_ms;
    // Agents APM
    data.agents_http_throughput = agentsApmStats.agents_http_throughput;
    data.agents_http_error_rate = agentsApmStats.agents_http_error_rate;
    data.agents_http_p95_ms     = agentsApmStats.agents_http_p95_ms;
    data.agents_chat_throughput = agentsApmStats.agents_chat_throughput;
    data.agents_chat_p95_ms     = agentsApmStats.agents_chat_p95_ms;
    data.agents_publish_count   = agentsApmStats.agents_publish_count;
    // Agents traces
    data.agents_invocation_count           = agentsTracesStats.agents_invocation_count;
    data.agents_invocation_failure_count   = agentsTracesStats.agents_invocation_failure_count;
    data.agents_invocation_abort_count     = agentsTracesStats.agents_invocation_abort_count;
    data.agents_invocation_fetch_fail_count = agentsTracesStats.agents_invocation_fetch_fail_count;
    data.agents_toolcall_count             = agentsTracesStats.agents_toolcall_count;
    data.agents_outbound_timeout_count     = agentsTracesStats.agents_outbound_timeout_count;
    // Agents logs
    data.agents_ai_call_count       = agentsLogsStats.agents_ai_call_count;
    data.agents_http_error_count    = agentsLogsStats.agents_http_error_count;
    data.agents_auth_failure_count  = agentsLogsStats.agents_auth_failure_count;
    data.agents_embedding_error_count = agentsLogsStats.agents_embedding_error_count;
    // Loki (Nomad container logs)
    data.agent_run_count                = lokiStats.agent_run_count;
    data.tool_failure_count             = lokiStats.tool_failure_count;
    data.skill_activation_failure_count = lokiStats.skill_activation_failure_count;
    data.typecheck_failure_count        = lokiStats.typecheck_failure_count;
    data.budget_exhaustion_count        = lokiStats.budget_exhaustion_count;
    data.sse_error_count                = lokiStats.sse_error_count;
    data.agent_publish_failure_count    = lokiStats.agent_publish_failure_count;
    data.preview_http_5xx_count         = lokiStats.preview_http_5xx_count;
    data.preview_http_502_count         = lokiStats.preview_http_502_count;
    data.preview_http_401_count         = lokiStats.preview_http_401_count;
    data.publish_http_5xx_count         = lokiStats.publish_http_5xx_count;

    await writeStatsDoc(
      writeClient,
      cfg.statsIndex,
      buildStatsDoc(
        data, '1h', endIso, '',
        errorEventNames,
        agentsTracesStats.agentToolNames,
        lokiStats.failedSkillNames,
        lokiStats.topToolNames,
      ),
    );
    return { ok: true, mode: 'tripwire' };
  }

  // ── Daily mode ────────────────────────────────────────────────────────────
  const rows = await loadRecentRows(writeClient, cfg.statsIndex, 24);
  const [baselines, dailyStatDocs] = await Promise.all([
    loadBaselines(writeClient, cfg.statsIndex),
    loadRecentDailyStats(writeClient, cfg.statsIndex, 7),
  ]);
  const seriesCandidates = detectSeries(rows, baselines);
  const trendCandidates = detectTrends(dailyStatDocs);
  const candidates = mergeCandidates(seriesCandidates, trendCandidates);
  const dayAgg = aggregateDay(rows.map((r) => r.data));

  if (dayAgg.log_count === 0) {
    console.warn('watchtower.daily.no_data rows=%d — pipeline may be down or app had no traffic', rows.length);
  }

  // Warn on partial-day coverage — z-scores computed over < 18 of 24 hours
  // are unreliable; surface this in the digest rather than rendering all-clear.
  const EXPECTED_HOURS = 24;
  const PARTIAL_THRESHOLD = 18;
  const isPartialDay = rows.length < PARTIAL_THRESHOLD;
  if (isPartialDay) {
    console.warn('watchtower.daily.partial_coverage rows=%d expected=%d', rows.length, EXPECTED_HOURS);
  }

  // Fresh 24h latency queries — accurate p95 computed from raw histogram data.
  // Aggregating hourly p95 values (MAX or otherwise) is mathematically wrong;
  // the only correct approach is to query the source with the full 24h window
  // and let ES/the collector compute the percentile from all underlying data.
  // These replace the latency fields in dayAgg (counts/rates stay from stored rows).
  const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const dayEnd = new Date().toISOString();
  const [freshApmRes, freshAgentsApmRes, freshAppRes, freshCwRes] = await Promise.allSettled([
    cfg.apmServiceName
      ? collectApm(readClient, cfg.apmIndex, cfg.apmServiceName, dayStart, dayEnd)
      : Promise.resolve(null),
    collectAgentsApm(readClient, cfg.apmIndex, dayStart, dayEnd),
    collectHour(readClient, cfg.appLogIndex, dayStart, dayEnd),
    cfg.albLoadBalancerName
      ? collectCloudwatch(readClient, 'metrics-aws.cloudwatch*', cfg.albLoadBalancerName, dayStart, dayEnd)
      : Promise.resolve(null),
  ]);
  // Override only latency fields — counts/rates come from aggregated hourly rows.
  // Log rejections explicitly: silent fallback keeps the aggregated MAX value
  // which is mathematically wrong (see comment above); operators need to know.
  if (freshApmRes.status === 'rejected') {
    console.warn('watchtower.daily.fresh_latency.apm.failed — using aggregated p95 (inaccurate)', freshApmRes.reason);
  } else if (freshApmRes.value) {
    dayAgg.latency_p50_ms = freshApmRes.value.latency_p50_ms;
    dayAgg.latency_p95_ms = freshApmRes.value.latency_p95_ms;
  }
  if (freshAgentsApmRes.status === 'rejected') {
    console.warn('watchtower.daily.fresh_latency.agents_apm.failed — using aggregated p95 (inaccurate)', freshAgentsApmRes.reason);
  } else {
    dayAgg.agents_http_p95_ms = freshAgentsApmRes.value.agents_http_p95_ms;
    dayAgg.agents_chat_p95_ms = freshAgentsApmRes.value.agents_chat_p95_ms;
  }
  if (freshAppRes.status === 'rejected') {
    console.warn('watchtower.daily.fresh_latency.app.failed — using aggregated p95 (inaccurate)', freshAppRes.reason);
  } else {
    dayAgg.sse_connect_p95_ms        = freshAppRes.value.data.sse_connect_p95_ms;
    dayAgg.sse_first_response_p95_ms = freshAppRes.value.data.sse_first_response_p95_ms;
  }
  if (freshCwRes.status === 'rejected') {
    console.warn('watchtower.daily.fresh_latency.cloudwatch.failed — using aggregated p95 (inaccurate)', freshCwRes.reason);
  } else if (freshCwRes.value) {
    dayAgg.alb_p95_ms = freshCwRes.value.alb_p95_ms;
  }

  // LLM context: daily notes use a dedicated query for window=24h rows
  // (loadRecentRows hardcodes window=1h — empty intersection with 24h docs).
  const recentNotes = await loadRecentDailyNotes(writeClient, cfg.statsIndex, 7);

  // Collect distinct error event names + agent tool names across all 24h rows
  const errorEventNameSet = new Set<string>();
  const agentToolNameSet = new Set<string>();
  // For skill failures and tool usage, accumulate counts across 24h rows then re-rank
  const skillFailCounts = new Map<string, number>();
  const toolUsageCounts = new Map<string, number>();
  for (const row of rows) {
    for (const name of row.error_event_names) errorEventNameSet.add(name);
    for (const name of row.agent_tool_names) agentToolNameSet.add(name);
    // Use lastIndexOf(':') to handle tool/skill names that themselves contain colons
    for (const entry of row.failed_skill_names) {
      const sep = entry.lastIndexOf(':');
      if (sep > 0) {
        const skill = entry.slice(0, sep);
        skillFailCounts.set(skill, (skillFailCounts.get(skill) ?? 0) + (parseInt(entry.slice(sep + 1), 10) || 0));
      }
    }
    for (const entry of row.top_tool_names) {
      const sep = entry.lastIndexOf(':');
      if (sep > 0) {
        const tool = entry.slice(0, sep);
        toolUsageCounts.set(tool, (toolUsageCounts.get(tool) ?? 0) + (parseInt(entry.slice(sep + 1), 10) || 0));
      }
    }
  }
  const errorEventNames = [...errorEventNameSet].sort();
  const agentToolNames = [...agentToolNameSet].sort().slice(0, 50);
  const failedSkillNames = [...skillFailCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([s, c]) => `${s}:${c}`);
  const topToolNames = [...toolUsageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t, c]) => `${t}:${c}`);

  // Run LLM reasoner — bulkheaded (skipped when GoCode not configured or call fails)
  // Known: GOCODE_ROLE_ARN env var uses config.account but the sts:AssumeRole IAM
  // grant uses cdk.Aws.ACCOUNT_ID. In test these differ (config.account resolves to
  // a v2-cell account vs the deployment account 694282668781 where the role lives),
  // so the LLM is silently skipped in test. This is documented in docs/watchtower
  // (design.md) as a deferred fix — prod works correctly. Fix when test LLM is needed:
  // derive GOCODE_ROLE_ARN from cdk.Aws.ACCOUNT_ID in watchtower-stack.ts.
  let verdict: Verdict | undefined;
  let llmFailed = false;
  const llmExpected = Boolean(cfg.gocodeRoleArn && cfg.gocodeEndpoint && dayAgg.log_count > 0);
  if (llmExpected) {
    try {
      const jwt = await getGocodeJwt(cfg.gocodeRoleArn, cfg.ssoHost);
      verdict = await runLlmReasoner(dayAgg, candidates, recentNotes, errorEventNames, agentToolNames, failedSkillNames, topToolNames, cfg.gocodeEndpoint, jwt);
      console.log('watchtower.daily.llm.verdict severity=%s', verdict.severity);
      const nowIso = new Date().toISOString();
      await writeStatsDoc(
        writeClient,
        cfg.statsIndex,
        buildStatsDoc(dayAgg, '24h', nowIso, verdict.notes),
      );
    } catch (err) {
      console.error('watchtower.daily.llm.error — skipping LLM verdict', err);
      llmFailed = true;
    }
  } else if (!cfg.gocodeRoleArn || !cfg.gocodeEndpoint) {
    console.log('watchtower.daily.llm.skipped reason=gocode-not-configured');
  }

  const posted = await postSlack(
    cfg.slackWebhookUrl,
    buildDigestBlocks(dayAgg, candidates, verdict, { llmFailed, isPartialDay }),
  );
  return { ok: true, mode: 'daily', posted, verdict: verdict?.severity };
}

import { loadConfig } from './config.js';
import { makeReadClient, makeWriteClient } from './es-clients.js';
import { ensureStatsIndex } from './bootstrap.js';
import { collectHour } from './collector.js';
import { collectApm } from './apm-collector.js';
import { collectCloudwatch } from './cloudwatch-collector.js';
import { buildStatsDoc, writeStatsDoc } from './writer.js';
import {
  loadBaselines,
  loadRecentRows,
  loadRecentDailyNotes,
  loadEventNameBaseline,
  detectSeries,
} from './detector.js';
import { buildDigestBlocks, postSlack } from './reporter.js';
import { hourWindow } from './windows.js';
import { aggregateDay } from './aggregate.js';
import { getGocodeJwt } from './gocode-auth.js';
import { runLlmReasoner, type Verdict } from './llm-reasoner.js';

export interface WatchtowerEvent { mode: 'daily' | 'tripwire' }
export interface HandlerResult { ok: boolean; mode: string; posted?: boolean; verdict?: string }

const EMPTY_APM = { req_throughput: 0, req_error_rate: 0, latency_p50_ms: 0, latency_p95_ms: 0 };
const EMPTY_CW  = { alb_5xx_count: 0, alb_req_count: 0, alb_p95_ms: 0 };

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
    const [appRes, apmRes, cwRes] = await Promise.allSettled([
      collectHour(readClient, cfg.appLogIndex, startIso, endIso),
      cfg.apmServiceName
        ? collectApm(readClient, cfg.apmIndex, cfg.apmServiceName, startIso, endIso)
        : Promise.resolve(EMPTY_APM),
      cfg.albLoadBalancerName
        ? collectCloudwatch(readClient, 'metrics-aws.cloudwatch*', cfg.albLoadBalancerName, startIso, endIso)
        : Promise.resolve(EMPTY_CW),
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

    const apmStats = apmRes.status === 'fulfilled' ? apmRes.value : EMPTY_APM;
    const cwStats  = cwRes.status  === 'fulfilled' ? cwRes.value  : EMPTY_CW;
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

    await writeStatsDoc(
      writeClient,
      cfg.statsIndex,
      buildStatsDoc(data, '1h', endIso, '', errorEventNames),
    );
    return { ok: true, mode: 'tripwire' };
  }

  // ── Daily mode ────────────────────────────────────────────────────────────
  const rows = await loadRecentRows(writeClient, cfg.statsIndex, 24);
  const baselines = await loadBaselines(writeClient, cfg.statsIndex);
  const candidates = detectSeries(rows, baselines);
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

  // LLM context: daily notes use a dedicated query for window=24h rows
  // (loadRecentRows hardcodes window=1h — empty intersection with 24h docs).
  const recentNotes = await loadRecentDailyNotes(writeClient, cfg.statsIndex, 7);

  // Collect distinct error event names across all 24h rows (ground truth from logs)
  const errorEventNameSet = new Set<string>();
  for (const row of rows) {
    for (const name of row.error_event_names) errorEventNameSet.add(name);
  }
  const errorEventNames = [...errorEventNameSet].sort();

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
      verdict = await runLlmReasoner(dayAgg, candidates, recentNotes, errorEventNames, cfg.gocodeEndpoint, jwt);
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

export interface LokiStats {
  // ── Agents (per-customer Nomad containers) ───────────────────────────────
  agent_run_count: number;               // lower-is-bad
  tool_failure_count: number;            // higher-is-bad
  skill_activation_failure_count: number; // higher-is-bad
  typecheck_failure_count: number;       // higher-is-bad
  budget_exhaustion_count: number;       // higher-is-bad (users hitting limits)
  sse_error_count: number;               // higher-is-bad
  agent_publish_failure_count: number;   // higher-is-bad
  // ── Preview containers ───────────────────────────────────────────────────
  preview_http_5xx_count: number;        // higher-is-bad
  preview_http_502_count: number;        // higher-is-bad (container unreachable)
  preview_http_401_count: number;        // higher-is-bad
  // ── Publish containers ───────────────────────────────────────────────────
  publish_http_5xx_count: number;        // higher-is-bad
  // ── String[] context for LLM (not numeric metrics) ───────────────────────
  /** "skill:count" — which skills failed to activate, sorted by count desc */
  failedSkillNames: string[];
  /** "tool:count" — top tools by execution volume, sorted by count desc */
  topToolNames: string[];
}

interface LokiVectorResult {
  metric: Record<string, string>;
  value: [number, string];
}

interface LokiResponse {
  status: string;
  data?: { resultType: string; result: LokiVectorResult[] };
}

async function lokiQuery(
  endpoint: string,
  apiKey: string,
  query: string,
  timeUnix: number,
): Promise<LokiVectorResult[]> {
  const url = new URL(`${endpoint}/loki/api/v1/query`);
  url.searchParams.set('query', query);
  url.searchParams.set('time', String(timeUnix));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(18_000),
  });
  if (!res.ok) throw new Error(`Loki HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json() as LokiResponse;
  return d.data?.result ?? [];
}

export function sumResults(results: LokiVectorResult[]): number {
  return results.reduce((acc, r) => acc + (parseInt(r.value[1], 10) || 0), 0);
}

export function byLabel(results: LokiVectorResult[], label: string): [string, number][] {
  return results
    .map((r): [string, number] => [r.metric[label] ?? '', parseInt(r.value[1], 10) || 0])
    .filter(([k]) => k !== '')
    .sort((a, b) => b[1] - a[1]);
}

export function statusCount(results: LokiVectorResult[], ...codes: string[]): number {
  const byStatus = new Map(results.map((r) => [r.metric.status ?? '', parseInt(r.value[1], 10) || 0]));
  return codes.reduce((s, c) => s + (byStatus.get(c) ?? 0), 0);
}

export async function collectLoki(
  endpoint: string,
  apiKey: string,
  lokiEnv: string,
  endUnix: number,
): Promise<LokiStats> {
  const ag = `{job="airo-agents", env="${lokiEnv}"}`;
  const pv = `{job="airo-preview-application", env="${lokiEnv}"}`;
  const pb = `{job="airo-publish-application", env="${lokiEnv}"}`;
  const w = '1h';

  const q = (query: string) => lokiQuery(endpoint, apiKey, query, endUnix);

  // Run all queries in parallel; individual failures degrade to [] via allSettled
  const results = await Promise.allSettled([
    /* 0 */ q(`sum(count_over_time(${ag} | json | __error__="" | event="agent.run.finish" [${w}]))`),
    /* 1 */ q(`sum(count_over_time(${ag} | json | __error__="" | event="ai-lib.agent-factory.tool.execution.failure" [${w}]))`),
    /* 2 */ q(`topk(30, sum by (data_skill) (count_over_time(${ag} | json | __error__="" | event="skill.tools.activation_failed" [${w}])))`),
    /* 3 */ q(`sum(count_over_time(${ag} | json | __error__="" | event="agent.typecheck.fail" [${w}]))`),
    /* 4 */ q(`sum(count_over_time(${ag} | json | __error__="" | event="budget.precheck.no_capacity" [${w}]))`),
    /* 5 */ q(`sum(count_over_time(${ag} | json | __error__="" | event="sse.execution.error" [${w}]))`),
    /* 6 */ q(`sum(count_over_time(${ag} | json | __error__="" | event=~"publish.flow.failure|publish-client.failed" [${w}]))`),
    /* 7 */ q(`topk(25, sum by (data_toolName) (count_over_time(${ag} | json | __error__="" | event="develop_agent.tool.execution.complete" [${w}])))`),
    /* 8 */ q(`sum by (status) (count_over_time(${pv} | json | __error__="" | status != "" [${w}]))`),
    /* 9 */ q(`sum by (status) (count_over_time(${pb} | json | __error__="" | status != "" [${w}]))`),
  ]);

  const ok = (i: number): LokiVectorResult[] => {
    const r = results[i];
    if (r.status === 'rejected') {
      console.warn('watchtower.loki_collector.query_failed idx=%d', i, r.reason);
      return [];
    }
    return r.value;
  };

  const previewStatus = ok(8);
  const publishStatus = ok(9);
  const skillFailures = ok(2);
  const topTools = ok(7);

  return {
    agent_run_count: sumResults(ok(0)),
    tool_failure_count: sumResults(ok(1)),
    skill_activation_failure_count: sumResults(skillFailures),
    typecheck_failure_count: sumResults(ok(3)),
    budget_exhaustion_count: sumResults(ok(4)),
    sse_error_count: sumResults(ok(5)),
    agent_publish_failure_count: sumResults(ok(6)),
    preview_http_5xx_count: statusCount(previewStatus, '500', '502', '503', '504'),
    preview_http_502_count: statusCount(previewStatus, '502'),
    preview_http_401_count: statusCount(previewStatus, '401'),
    publish_http_5xx_count: statusCount(publishStatus, '500', '502', '503', '504'),
    // Encoded as "name:count" — use lastIndexOf(':') when parsing to handle names with colons
    failedSkillNames: byLabel(skillFailures, 'data_skill').map(([s, c]) => `${s}:${c}`),
    topToolNames: byLabel(topTools, 'data_toolName').map(([t, c]) => `${t}:${c}`),
  };
}

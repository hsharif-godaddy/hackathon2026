import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APP_CONTEXT } from './app-context.js';
import { type Candidate } from './detector.js';
import { type StatData } from './types.js';

const MODEL = 'claude-sonnet-4-6';

export interface Verdict {
  severity: 'P1' | 'P2' | 'P3' | 'none';
  summary: string;
  likely_cause: string;
  notes: string;
}

const FALLBACK_VERDICT: Verdict = {
  severity: 'none',
  summary: 'LLM verdict unavailable — see stat anomalies above.',
  likely_cause: 'Unknown',
  notes: '',
};

function formatStats(agg: StatData): string {
  return [
    `log_count=${agg.log_count} error_rate=${(agg.error_rate * 100).toFixed(2)}% warn_count=${agg.warn_count}`,
    `publish_success_rate=${(agg.publish_success_rate * 100).toFixed(1)}% (${agg.publish_success}✓ ${agg.publish_failure}✗)`,
    `create_success_rate=${(agg.create_success_rate * 100).toFixed(1)}% (${agg.create_success}✓ ${agg.create_failure}✗)`,
    `preview_timeouts=${agg.preview_timeouts}`,
    `new_error_fingerprints=${agg.new_error_fingerprints} distinct_error_events=${agg.distinct_error_events}`,
    `req_throughput=${agg.req_throughput} req_error_rate=${(agg.req_error_rate * 100).toFixed(2)}%`,
    `latency_p95_ms=${agg.latency_p95_ms} sse_first_response_p95_ms=${agg.sse_first_response_p95_ms}`,
    `alb_5xx_count=${agg.alb_5xx_count} alb_p95_ms=${agg.alb_p95_ms}`,
    `--- agents service ---`,
    `agents_http_throughput=${agg.agents_http_throughput} agents_http_error_rate=${(agg.agents_http_error_rate * 100).toFixed(2)}% agents_http_p95_ms=${agg.agents_http_p95_ms}`,
    `agents_chat_throughput=${agg.agents_chat_throughput} agents_chat_p95_ms=${agg.agents_chat_p95_ms}ms agents_publish_count=${agg.agents_publish_count}`,
    `agents_invocations=${agg.agents_invocation_count} failures=${agg.agents_invocation_failure_count} aborts=${agg.agents_invocation_abort_count} fetch_fails=${agg.agents_invocation_fetch_fail_count}`,
    `agents_toolcalls=${agg.agents_toolcall_count} outbound_timeouts=${agg.agents_outbound_timeout_count}`,
    `agents_ai_calls=${agg.agents_ai_call_count} [NOTE: Katana ECS dev-private only; expected=0 in prod — prod AI calls covered by agent_run_count/tool_failures via Loki above] agents_http_errors=${agg.agents_http_error_count} auth_failures=${agg.agents_auth_failure_count} embedding_errors=${agg.agents_embedding_error_count}`,
    `--- loki (nomad container logs) ---`,
    `agent_runs=${agg.agent_run_count} tool_failures=${agg.tool_failure_count} skill_activation_failures=${agg.skill_activation_failure_count}`,
    `typecheck_failures=${agg.typecheck_failure_count} budget_exhaustions=${agg.budget_exhaustion_count} sse_errors=${agg.sse_error_count} agent_publish_failures=${agg.agent_publish_failure_count}`,
    `preview_5xx=${agg.preview_http_5xx_count} preview_502=${agg.preview_http_502_count} publish_5xx=${agg.publish_http_5xx_count}`,
  ].join('\n');
}

function formatCandidates(candidates: Candidate[]): string {
  if (candidates.length === 0) return 'None — no statistical anomalies detected.';
  return candidates
    .sort((a, b) => (a.severity < b.severity ? -1 : 1))
    .map((c) => {
      if (c.trend_streak != null) {
        return `  [${c.severity}] ${c.stat}: ${c.trend_streak}-day escalating trend: ${(c.trend_values ?? []).join('→')}`;
      }
      return `  [${c.severity}] ${c.stat}: observed=${c.observed} median=${c.median} z=${c.robustZ.toFixed(2)}`;
    })
    .join('\n');
}

export async function runLlmReasoner(
  dayAgg: StatData,
  candidates: Candidate[],
  recentNotes: string[],
  errorEventNames: string[],
  agentToolNames: string[],
  failedSkillNames: string[],
  topToolNames: string[],
  gocodeEndpoint: string,
  jwt: string,
): Promise<Verdict> {
  const provider = createOpenAICompatible({
    name: 'gocode',
    baseURL: gocodeEndpoint.endsWith('/v1') ? gocodeEndpoint : `${gocodeEndpoint}/v1`,
    // Placeholder API key — real auth is the sso-jwt header below
    apiKey: 'sso-jwt',
    headers: { Authorization: `sso-jwt ${jwt}` },
  });

  const notesBlock = recentNotes.length > 0
    ? `Recent context (last ${recentNotes.length} daily notes):\n${recentNotes.slice(-5).map((n, i) => `  Day -${recentNotes.length - i}: ${n}`).join('\n')}`
    : 'No prior notes available (first run or baseline building).';

  const newFingerprintDetections = dayAgg.new_error_fingerprints;
  const allCount = errorEventNames.length;
  // new_error_fingerprints is summed across hourly rows: one new event name appearing
  // in 5 hours contributes 5 to the total but only 1 distinct name to allCount.
  // Do NOT compute allCount - newFingerprintDetections; it can go negative and is meaningless.
  const errorNamesBlock = errorEventNames.length > 0
    ? `Error event names seen today (${allCount} distinct names; new_error_fingerprints stat=${newFingerprintDetections} = total hourly detections of names absent from 7-day baseline, can exceed allCount when one new name recurs across hours):\n  ${errorEventNames.slice(0, 50).join(', ')}`
    : 'No failure events recorded in last 24h.';

  const toolNamesBlock = agentToolNames.length > 0
    ? `Agent tool names invoked in last 24h: ${agentToolNames.join(', ')}`
    : 'No agent tool call data available.';

  const failedSkillsBlock = failedSkillNames.length > 0
    ? `Skills that failed to activate in last 24h (skill:count, sorted by frequency):\n  ${failedSkillNames.join(', ')}`
    : 'No skill activation failures recorded in last 24h.';

  const topToolsBlock = topToolNames.length > 0
    ? `Top tools by execution volume in last 24h (tool:count):\n  ${topToolNames.join(', ')}`
    : 'No tool execution data available.';

  const prompt = `${APP_CONTEXT}

---
## Today's 24-hour aggregated stats
${formatStats(dayAgg)}

## Statistical anomalies detected (MAD z-score)
${formatCandidates(candidates)}

## ${errorNamesBlock}

## ${toolNamesBlock}

## ${failedSkillsBlock}

## ${topToolsBlock}

## ${notesBlock}

---
Based on the above, provide your verdict for today's Watchtower digest.
Grade the severity according to the rubric. Be concise and specific — when naming errors, use the actual event names from the log.

Respond with ONLY a valid JSON object — no markdown, no explanation, no trailing text after the closing brace:
{
  "severity": "P1",
  "summary": "max 2 sentences, be specific",
  "likely_cause": "max 1 sentence, or Unknown",
  "notes": "max 1 sentence for tomorrow context, or empty string"
}`;

  const result = await generateText({
    model: provider(MODEL),
    prompt,
    maxOutputTokens: 4096,
    abortSignal: AbortSignal.timeout(60_000),
  });

  const raw = result.text.trim();
  // Strip markdown code fences if the model wraps the JSON
  const stripped = raw.startsWith('```') ? raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '') : raw;
  // If truncated mid-JSON, close open braces so JSON.parse has a chance
  const jsonStr = stripped.endsWith('}') ? stripped : `${stripped.replace(/,?\s*"[^"]*"\s*:\s*"[^"]*$/, '')}"}`;
  try {
    const parsed = JSON.parse(jsonStr) as Partial<Verdict>;
    const severities = new Set(['P1', 'P2', 'P3', 'none']);
    return {
      severity: severities.has(parsed.severity ?? '') ? (parsed.severity as Verdict['severity']) : 'none',
      summary: parsed.summary ?? FALLBACK_VERDICT.summary,
      likely_cause: parsed.likely_cause ?? 'Unknown',
      notes: parsed.notes ?? '',
    };
  } catch {
    // Last resort: extract severity from raw text via regex
    const sev = /severity["\s:]+([P][123]|none)/i.exec(raw)?.[1];
    const severities = new Set(['P1', 'P2', 'P3', 'none']);
    if (sev && severities.has(sev)) {
      console.warn('watchtower.llm.json_partial_recovery severity=%s', sev);
      return { ...FALLBACK_VERDICT, severity: sev as Verdict['severity'] };
    }
    console.warn('watchtower.llm.json_parse_failed raw=%s', raw.slice(0, 200));
    return FALLBACK_VERDICT;
  }
}

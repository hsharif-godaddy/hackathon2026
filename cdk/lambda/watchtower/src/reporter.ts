import type { StatData } from './types.js';
import type { Candidate } from './detector.js';
import type { Verdict } from './llm-reasoner.js';

// Format a stat value for display: rate stats (0–1) render as a percentage so
// the candidate line agrees with the context summary; everything else is the
// raw number.
function fmtStat(stat: Candidate['stat'], value: number): string {
  return String(stat).endsWith('_rate') ? `${(value * 100).toFixed(2)}%` : String(value);
}

const SEVERITY_EMOJI: Record<string, string> = {
  P1: ':red_circle:',
  P2: ':large_yellow_circle:',
  P3: ':large_blue_circle:',
  none: ':large_green_circle:',
};

export interface DigestFlags {
  llmFailed?: boolean;
  isPartialDay?: boolean;
}

export function buildDigestBlocks(today: StatData, candidates: Candidate[], verdict?: Verdict, flags: DigestFlags = {}): unknown[] {
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: '*AAB Watchtower — daily digest*' } },
  ];

  if (flags.isPartialDay) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `:warning: *Partial coverage* — only some hourly rows collected. Stats and z-scores may be unreliable.` }],
    });
  }

  if (today.log_count === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':warning: *No data* — zero app log events collected in the last 24h. The collection pipeline may be down, or the app had no traffic. Detection skipped.',
      },
    });
  } else if (verdict) {
    // LLM verdict available — lead with the summary, then list anomalies
    const emoji = SEVERITY_EMOJI[verdict.severity] ?? ':white_circle:';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${verdict.severity === 'none' ? 'All clear' : verdict.severity}* — ${verdict.summary}`,
      },
    });
    if (verdict.likely_cause && verdict.likely_cause !== 'Unknown') {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `*Likely cause:* ${verdict.likely_cause}` }],
      });
    }
    if (candidates.length > 0) {
      blocks.push({ type: 'divider' });
      for (const c of candidates) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: c.robustZ === 0
              ? `*${c.severity}* \`${c.stat}\` — observed ${fmtStat(c.stat, c.observed)} (threshold alert)`
              : `*${c.severity}* \`${c.stat}\` — observed ${fmtStat(c.stat, c.observed)} vs median ${fmtStat(c.stat, c.median)} (z=${c.robustZ.toFixed(1)})`,
          },
        });
      }
    }
  } else if (flags.llmFailed) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':warning: *LLM verdict unavailable* — statistical detection only. Check CloudWatch logs for details.',
      },
    });
    for (const c of candidates) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: c.robustZ === 0
            ? `*${c.severity}* \`${c.stat}\` — observed ${fmtStat(c.stat, c.observed)} (threshold alert)`
            : `*${c.severity}* \`${c.stat}\` — observed ${fmtStat(c.stat, c.observed)} vs median ${fmtStat(c.stat, c.median)} (z=${c.robustZ.toFixed(1)})`,
        },
      });
    }
  } else if (candidates.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':large_green_circle: All green — no anomalies vs the prior 6-day baseline (last 24h excluded).',
      },
    });
  } else {
    for (const c of candidates) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: c.robustZ === 0
            ? `*${c.severity}* \`${c.stat}\` — observed ${fmtStat(c.stat, c.observed)} (threshold alert)`
            : `*${c.severity}* \`${c.stat}\` — observed ${fmtStat(c.stat, c.observed)} vs median ${fmtStat(c.stat, c.median)} (z=${c.robustZ.toFixed(1)})`,
        },
      });
    }
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: [
        `logs ${today.log_count}`,
        `errors ${today.error_count} (${(today.error_rate * 100).toFixed(2)}%)`,
        `publish_ok ${(today.publish_success + today.publish_failure) > 0 ? `${(today.publish_success_rate * 100).toFixed(1)}%` : 'N/A'}`,
        `create_ok ${(today.create_success + today.create_failure) > 0 ? `${(today.create_success_rate * 100).toFixed(1)}%` : 'N/A'}`,
        `ttft_p95 ${Math.round(today.sse_first_response_p95_ms)}ms`,
        `alb_5xx ${today.alb_5xx_count}`,
      ].join(' · '),
    }],
  });
  return blocks;
}

export async function postSlack(webhookUrl: string, blocks: unknown[], fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!webhookUrl || !webhookUrl.startsWith('https://hooks.slack.com/')) {
    console.log('watchtower.slack.skipped reason=webhook-not-configured');
    return false;
  }
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error('watchtower.slack.post.failed status=%d', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('watchtower.slack.post.error', err);
    return false;
  }
}

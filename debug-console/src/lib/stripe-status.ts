import { resolveAppCluster } from '@/lib/investigate/evidence';
import { getLogSourceConfig } from '@/lib/log-sources';
import { logger } from '@/lib/logger';
import { buildLokiQuery, queryLoki, type LokiQueryResponse } from '@/lib/loki-client';

/**
 * Stripe integration state for an app, derived from the agents' Loki logs.
 *
 * The agents service persists Stripe sandbox state in the standalone
 * stripe-service (DynamoDB), which the debug-console cannot reach directly
 * (awsiam service-to-service auth). Rather than take a new cross-service
 * dependency, we infer Stripe commerce intent from the agent log events:
 *
 *   1. Skill-install events for the `payment/stripe` skill, keyed off
 *      `data.skill` / `data.skillName === 'payment/stripe'`
 *      (`skill.install.file_copied`, `skill.install.success`,
 *      `applied_skills.install.recorded`, ...). This is the authoritative
 *      "the app added Stripe checkout" signal; `skill.install.success` /
 *      `applied_skills.install.recorded` mark it as fully `skillInstalled`.
 *
 *   2. Provisioning-skill events (`skill.stripe.setup.*` / `skill.stripe.status.*`).
 *      The terminal events decide whether a Stripe sandbox is `configured`:
 *        - `skill.stripe.setup.success`   { appId, sandboxId }            -> configured
 *        - `skill.stripe.status.success`  { appId, sandboxId, claimStatus} -> configured
 *        - `skill.stripe.setup.legacy`    { appId }                        -> configured (claimStatus `legacy`)
 *        - `skill.stripe.status.not_found`{ appId }                        -> not configured
 *        - `setup.begin` / `status.begin` / `inputs_needed` / `error` / ... -> intent only
 *
 *   3. Develop file-edit events (`develop_agent.tool.file_*`) whose `data.filePath`
 *      touches a Stripe code path — a fallback intent signal for hand-edited apps.
 *
 * Any of the above sets `detected` (intent). The most recent terminal
 * provisioning event wins, so a later not_found clears a stale earlier success.
 * Subject to Loki retention: signals older than the window read as not-detected.
 */
export interface StripeStatus {
  detected: boolean;
  skillInstalled: boolean;
  configured: boolean;
  sandboxId: string | null;
  claimStatus: string | null;
  lastSeenAt: string | null;
}

const STRIPE_SKILL_EVENT_REGEX = /^skill\.stripe\.(setup|status)\./;
const STRIPE_SKILL_NAME = 'payment/stripe';
const SKILL_INSTALLED_EVENTS = new Set([
  'skill.install.success',
  'applied_skills.install.recorded',
]);

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LINES = 50;

function parseLine(line: string): {
  event: string | null;
  sandboxId: string | null;
  claimStatus: string | null;
  skillName: string | null;
  stripeFile: boolean;
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { event: null, sandboxId: null, claimStatus: null, skillName: null, stripeFile: false };
  }
  const data = (parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed) as Record<
    string,
    unknown
  >;
  const event = typeof parsed.event === 'string' ? parsed.event : null;
  const sandboxId =
    typeof data.sandboxId === 'string'
      ? data.sandboxId
      : typeof parsed.sandboxId === 'string'
        ? parsed.sandboxId
        : null;
  const claimStatus =
    typeof data.claimStatus === 'string'
      ? data.claimStatus
      : typeof parsed.claimStatus === 'string'
        ? parsed.claimStatus
        : null;
  const skillName =
    typeof data.skill === 'string'
      ? data.skill
      : typeof data.skillName === 'string'
        ? data.skillName
        : null;
  const filePath = typeof data.filePath === 'string' ? data.filePath : null;
  const stripeFile = filePath !== null && /stripe/i.test(filePath);
  return { event, sandboxId, claimStatus, skillName, stripeFile };
}

/**
 * Read the most recent Stripe lifecycle event for an app from Loki and reduce
 * it to a {@link StripeStatus}. Best-effort: any failure (Loki unconfigured,
 * network error, non-JSON response) degrades to a not-configured result rather
 * than throwing, so the Commerce panel still renders the GoDaddy binding.
 */
export async function getStripeStatusFromLogs(appId: string): Promise<StripeStatus> {
  const empty: StripeStatus = {
    detected: false,
    skillInstalled: false,
    configured: false,
    sandboxId: null,
    claimStatus: null,
    lastSeenAt: null,
  };

  let baseConfig: ReturnType<typeof getLogSourceConfig>;
  try {
    baseConfig = getLogSourceConfig('airo-agents');
  } catch (error) {
    logger.warn('agent.commerce.stripe.loki_unconfigured', { appId }, { error: error as Error });
    return empty;
  }
  if (!baseConfig || !baseConfig.lokiEndpoint) {
    logger.warn('agent.commerce.stripe.loki_unconfigured', { appId });
    return empty;
  }

  // Reuse the shared airo-agents Loki config (endpoint/apiKey/env/service_name)
  // and narrow to the app's cluster when resolvable, so this query inherits the
  // same selector the Logs tab uses and avoids a full-fleet scan.
  const labels: Record<string, string> = { ...(baseConfig.lokiLabels ?? {}) };
  const cluster = await resolveAppCluster(appId);
  if (cluster) {
    labels.cluster = cluster;
  }

  const config = {
    lokiEndpoint: baseConfig.lokiEndpoint,
    lokiApiKey: baseConfig.lokiApiKey,
    lokiLabels: labels,
    environment: baseConfig.environment,
  };

  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_MS);
  const lokiParams = await buildLokiQuery(
    {
      appId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      size: MAX_LINES,
    },
    config
  );
  // Append the Stripe-specific case-insensitive line filter on top of the
  // shared query shape (catches `skill.stripe.*`, `payment/stripe`, and stripe
  // file paths).
  lokiParams.query += ' |~ "(?i)stripe"';

  let response: LokiQueryResponse;
  try {
    response = await queryLoki(config, lokiParams);
  } catch (error) {
    logger.warn('agent.commerce.stripe.query_failed', { appId }, { error: error as Error });
    return empty;
  }

  const lines: Array<[string, string]> = [];
  for (const stream of response.data?.result ?? []) {
    for (const value of stream.values ?? []) {
      lines.push(value);
    }
  }
  if (lines.length === 0) {
    return empty;
  }

  lines.sort((a, b) => (BigInt(b[0]) > BigInt(a[0]) ? 1 : BigInt(b[0]) < BigInt(a[0]) ? -1 : 0));

  const result: StripeStatus = { ...empty };
  let configResolved = false;
  for (const [timestampNs, line] of lines) {
    const { event, sandboxId, claimStatus, skillName, stripeFile } = parseLine(line);
    if (!event) continue;
    const isProvisioningEvent = STRIPE_SKILL_EVENT_REGEX.test(event);
    const isStripeSkill = skillName === STRIPE_SKILL_NAME;
    if (!isProvisioningEvent && !isStripeSkill && !stripeFile) continue;
    const seenAt = new Date(Number(BigInt(timestampNs) / 1_000_000n)).toISOString();
    if (!result.detected) {
      result.detected = true;
      result.lastSeenAt = seenAt;
    }
    if (isStripeSkill && SKILL_INSTALLED_EVENTS.has(event)) {
      result.skillInstalled = true;
    }
    if (configResolved || !isProvisioningEvent) continue;
    if (event === 'skill.stripe.status.not_found') {
      configResolved = true;
    } else if (event === 'skill.stripe.setup.legacy') {
      result.configured = true;
      result.claimStatus = 'legacy';
      configResolved = true;
    } else if (event === 'skill.stripe.setup.success' || event === 'skill.stripe.status.success') {
      result.configured = true;
      result.sandboxId = sandboxId;
      result.claimStatus = claimStatus;
      configResolved = true;
    }
  }

  return result.detected ? result : empty;
}

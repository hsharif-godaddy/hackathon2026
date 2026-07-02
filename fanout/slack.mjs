import { getSecretString } from './secret-cache.mjs';
import {
  buildSupportRequestBlocks,
  buildBugReportBlocks,
  buildFeedbackBlocks,
  buildCustomerFeedbackBlocks,
} from './slack-builders.mjs';
import { formatSlackBlockMessage } from './slack-format.mjs';

const TIMEOUT_MS = 10_000;
const PLACEHOLDER_VALUE = 'REPLACE_ME';

/**
 * POST a feedback Slack message. Builds the same Block Kit shape the UI
 * builds today, including the Preview URL captured at submit time
 * (passed through unchanged from `row.preview_url`), Diagnostic Context links,
 * and category-specific layout (issue / support / feedback).
 *
 * Webhook URL fetched from CDK-owned Secrets Manager secret. The secret
 * holds a JSON payload `{"webhookUrl":"..."}`. Until ops fills the real
 * URL, the value is `{"webhookUrl":"REPLACE_ME"}` and this function
 * silently skips Slack so dev/test deploys don't error.
 *
 * @param {object} args
 * @param {string} args.category - 'issue' | 'support' | 'feedback' | 'customer-feedback'
 * @param {object} args.formData - { topics, description?, comment?, rating?, followUp?, customerConsent? }
 * @param {string|undefined} args.origin
 * @param {object} args.ctx - DiagnosticContext shape (see app/src/components/feedback/types.ts DiagnosticContext)
 * @param {object|null} [args.enrichment] - optional triage links prepended to the message:
 *   `{ crmCaseUrl?, jiraKey?, jiraUrl? }`. When omitted/null (e.g. happy NPS
 *   submissions with no CRM/Jira), the message renders identically to the
 *   legacy UI Block Kit shape. Investigation URL is intentionally NOT
 *   included — the investigator already posts its own deep-link as a CRM
 *   case note, and the kickoff note posts the same link upfront. Adding
 *   it here would be a third copy with no triage value-add.
 */
export async function postSlackMessage({ category, formData, origin, ctx, enrichment = null }) {
  const arn = process.env.SLACK_WEBHOOK_SECRET_ARN;
  if (!arn) {
    skipLog('SLACK_WEBHOOK_SECRET_ARN unset');
    return;
  }

  const url = await resolveWebhookUrl(arn);
  if (!url) return;

  if (category === 'customer-feedback' && process.env.SLACK_CUSTOMER_FEEDBACK_ENABLED === 'false') {
    skipLog('SLACK_CUSTOMER_FEEDBACK_ENABLED=false; skipping customer-feedback');
    return;
  }

  let blockMessage;
  switch (category) {
    case 'issue':
      blockMessage = buildBugReportBlocks(formData, origin, ctx, enrichment);
      break;
    case 'support':
      blockMessage = buildSupportRequestBlocks(formData, origin, ctx, enrichment);
      break;
    case 'feedback':
      blockMessage = buildFeedbackBlocks(formData, origin, ctx, enrichment);
      break;
    case 'customer-feedback':
      blockMessage = buildCustomerFeedbackBlocks(formData, origin, ctx, enrichment);
      break;
    default:
      throw new Error(`Unknown feedback category: ${category}`);
  }

  const slackBody = formatSlackBlockMessage(blockMessage);

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackBody),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Slack ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

async function resolveWebhookUrl(arn) {
  const raw = await getSecretString(arn);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const url = parsed?.webhookUrl;
  if (!url || url === PLACEHOLDER_VALUE) {
    skipLog('webhook URL still placeholder; ops fill required');
    return null;
  }
  return url;
}

function skipLog(reason) {
  console.log(JSON.stringify({ level: 'info', msg: 'fanout.slack.skipped', reason }));
}

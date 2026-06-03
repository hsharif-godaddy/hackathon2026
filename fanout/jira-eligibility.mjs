/**
 * Pure per-submission Jira-ticket eligibility.
 *
 * The fanout Lambda has no Switchboard client by design (no IAM grant). The
 * BFF (`app/src/app/api/feedback/s3-store/route.ts`) resolves the
 * `appbuilder-fanout-jira-eligibility` Switchboard value at submit time and
 * stamps the raw JSON string into the parquet column `jira_eligibility_config`.
 * This module parses that string and decides whether a given feedback row
 * should open an AABSP Jira ticket — mirroring how `fanout_via_lambda` is
 * resolved by the BFF and read by the Lambda.
 *
 * Config shape (single Switchboard string value):
 *   { "issue": false, "support": false, "feedback": { "enabled": true, "maxRating": 7 } }
 */

import { log } from './logger.mjs';

/**
 * Default eligibility when the Switchboard config is absent, null, or
 * malformed. Baseline: customer-facing NPS feedback below the rating
 * threshold opens a Prod Feedback triage ticket; issue (Bug) and support
 * (SOS) categories do NOT auto-file tickets. Flip the
 * `appbuilder-fanout-jira-eligibility` Switchboard value to re-enable
 * issue/support or to change the feedback rating threshold.
 *
 * `maxRating` uses a STRICT `<` comparison (`rating < maxRating`), matching
 * the legacy `rating < 7` gate — so the default maxRating 7 means ratings
 * 0..6 are eligible and 7 is not.
 */
export const DEFAULT_JIRA_ELIGIBILITY = Object.freeze({
  issue: false,
  support: false,
  feedback: Object.freeze({ enabled: true, maxRating: 7 }),
});

function cloneDefault() {
  return {
    issue: DEFAULT_JIRA_ELIGIBILITY.issue,
    support: DEFAULT_JIRA_ELIGIBILITY.support,
    feedback: { ...DEFAULT_JIRA_ELIGIBILITY.feedback },
  };
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Parse the raw Switchboard JSON value stamped into the parquet row. Defensive
 * field-by-field merge against DEFAULT_JIRA_ELIGIBILITY: a parse failure,
 * wrong-typed field, or missing key falls back to the default for that field
 * only, so a malformed Switchboard value degrades to the safe baseline rather
 * than flipping ticket creation on or off unexpectedly.
 *
 * @param {unknown} raw - JSON string | null | undefined from the parquet row
 * @returns {{issue: boolean, support: boolean, feedback: {enabled: boolean, maxRating: number}}}
 */
export function parseJiraEligibilityConfig(raw) {
  if (raw == null || raw === '') return cloneDefault();
  if (typeof raw !== 'string') {
    log('warn', 'fanout.jira.eligibility.bad_type', { rawType: typeof raw });
    return cloneDefault();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Don't echo `raw` — it's operator-controlled but logging its content adds
    // no value and risks noise. Name + length is enough to spot a bad value.
    log('warn', 'fanout.jira.eligibility.parse_failed', {
      errorName: err.name,
      rawLength: raw.length,
    });
    return cloneDefault();
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    log('warn', 'fanout.jira.eligibility.not_object', { parsedType: typeof parsed });
    return cloneDefault();
  }

  const d = DEFAULT_JIRA_ELIGIBILITY;
  const fb = parsed.feedback;
  const feedbackObj = (fb != null && typeof fb === 'object' && !Array.isArray(fb)) ? fb : {};

  // Surface operator typos (e.g. `enbaled` instead of `enabled`) without
  // false-flagging intentional partial configs: omitting a known key is fine
  // (it falls back to default), but an UNKNOWN key means a misspelling that
  // silently does nothing. Log it so it's discoverable in Loki.
  const unknownTop = Object.keys(parsed).filter((k) => k !== 'issue' && k !== 'support' && k !== 'feedback');
  const unknownFeedback = Object.keys(feedbackObj).filter((k) => k !== 'enabled' && k !== 'maxRating');
  if (unknownTop.length > 0 || unknownFeedback.length > 0) {
    log('warn', 'fanout.jira.eligibility.unknown_keys', { unknownTop, unknownFeedback });
  }

  return {
    issue: typeof parsed.issue === 'boolean' ? parsed.issue : d.issue,
    support: typeof parsed.support === 'boolean' ? parsed.support : d.support,
    feedback: {
      enabled: typeof feedbackObj.enabled === 'boolean' ? feedbackObj.enabled : d.feedback.enabled,
      maxRating: isFiniteNumber(feedbackObj.maxRating) ? feedbackObj.maxRating : d.feedback.maxRating,
    },
  };
}

/**
 * Decide whether to create an AABSP Jira ticket for this feedback row. Pure —
 * reads only `feedback_category`, `rating`, and the stamped
 * `jira_eligibility_config`.
 *
 *   - issue    → config.issue
 *   - support  → config.support
 *   - feedback → config.feedback.enabled && rating != null && rating < maxRating
 *   - unknown  → false (defensive; BFF + Lambda lock category to the three above)
 *
 * @param {object} row - parquet feedback row
 * @returns {boolean}
 */
export function shouldCreateJiraTicket(row) {
  const config = parseJiraEligibilityConfig(row.jira_eligibility_config);
  const cat = row.feedback_category;
  if (cat === 'issue') return config.issue === true;
  if (cat === 'support') return config.support === true;
  if (cat === 'feedback') {
    if (!config.feedback.enabled) return false;
    return row.rating != null && row.rating < config.feedback.maxRating;
  }
  return false;
}

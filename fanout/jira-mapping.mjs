/**
 * Pure mapping: parquet feedback row → Atlassian REST v3 create-issue body.
 *
 * Issue type per category:
 *   - issue    → "Bug"
 *   - support  → "SOS Support"
 *   - feedback → "Prod Feedback" (fanout gate already restricts to rating < 5)
 *
 * Custom fields populate the typed AABSP fields (App ID, Subscription/Plan,
 * Origin, Topics, Customer Consent, Feedback ID, S3 Object Reference,
 * Experiments, Rating). Field IDs from `getJiraIssueTypeMetaWithFields`
 * against AABSP — see CUSTOM_FIELD_IDS below.
 *
 * Description ADF stays as a redundant body copy of the same fields so that
 * ticket history + email alerts (which don't include custom-field values
 * unless the column is added) still carry the full context.
 *
 * Labels:
 *   - "AAB-App" only — fixed project tag the team filters on. Idempotency
 *     no longer rides on a `feedback-id-<id>` label; `findIssueByFeedbackId`
 *     in jira-client.mjs now JQL-searches the typed Feedback ID custom
 *     field (`cf[36238]`) instead, keeping the labels column uncluttered.
 *
 * customer_id intentionally NOT in labels — Jira labels are project-wide
 * searchable and not redactable per-issue, so customer/shopper IDs stay in
 * the description body only.
 */

import { log } from './logger.mjs';

const SUMMARY_MAX = 80;

const CUSTOM_FIELD_IDS = {
  team: 'customfield_14500',
  feedbackId: 'customfield_36238',
  rating: 'customfield_36239',
  appId: 'customfield_36240',
  origin: 'customfield_36241',
  topics: 'customfield_36242',
  customerConsent: 'customfield_36243',
  subscriptionPlan: 'customfield_36257',
  experiments: 'customfield_36258',
  s3ObjectReference: 'customfield_36259',
};

// Atlassian Team UUID for "Airo Engineering Support" — the AABSP triage
// team that owns customer-facing feedback tickets. Source of truth:
// https://home.atlassian.com/o/dc9d19c0-76bb-418a-a9b8-932af9da007a/people/team/9116cafc-8bf6-489f-ac38-8a2d6a5b3952
// Stamping every fanout-created ticket with this Team ensures it shows up
// on the team's queue, regardless of which Jira admin created the field.
const AIRO_ENGINEERING_SUPPORT_TEAM_ID = '9116cafc-8bf6-489f-ac38-8a2d6a5b3952';

function issueTypeName(category) {
  if (category === 'issue') return 'Bug';
  if (category === 'support') return 'SOS Support';
  if (category === 'feedback') return 'Prod Feedback';
  // Defensive: an unknown category should never reach here (BFF + Lambda
  // schema both lock it down to the three above), but if it does, fall back
  // to Bug so the ticket still lands rather than 400ing the create call.
  return 'Bug';
}

// Title-case label used in the empty-text fallback summary (`<Type> | App ID
// - <appId>`). Distinct from issuetype.name because the user-visible summary
// reads better as "SOS" / "Feedback" than as "SOS Support" / "Prod Feedback".
function summaryTypeLabel(category) {
  if (category === 'issue') return 'Bug';
  if (category === 'support') return 'SOS';
  if (category === 'feedback') return 'Feedback';
  return 'Feedback';
}

function buildSummary(row) {
  const text = (row.feedback_text ?? '').trim();
  if (!text) {
    return `${summaryTypeLabel(row.feedback_category)} | App ID - ${row.app_id ?? 'unknown'}`;
  }
  if (text.length <= SUMMARY_MAX) return text;
  return text.slice(0, SUMMARY_MAX - 1) + '…'; // single-char ellipsis
}

function paragraph(text) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

// Filter to string entries only — defensive against producer drift
// (tampered parquet, schema migration), since downstream mapping
// (`String(topic).replace(...)`) would otherwise emit `[object Object]`
// as a Jira topic. Exported so handler.mjs (Slack/investigator paths)
// shares the same hardened parsing — a single source of truth keeps the
// Jira-bound topics list and the Slack-bound topics list from diverging.
export function parseTopics(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : tryParseTopicsJson(raw);
  return arr.filter((t) => typeof t === 'string');
}

function tryParseTopicsJson(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // Producer-side contract drift (CSV, malformed JSON). Swallow rather
    // than fail the create — Topics is a non-critical field — but emit a
    // warn so dashboards surface the drift. We log only `errorName` and
    // shape metadata; the parser's error.message can echo the input
    // (e.g. "Unexpected token X in JSON at position N"), which would
    // leak PII into log streams if a producer ever wrote customer text
    // into this column.
    log('warn', 'fanout.jira.topics.parse_failed', {
      errorName: err.name,
      rawType: typeof raw,
      rawLength: typeof raw === 'string' ? raw.length : null,
    });
    return [];
  }
}

// Convert one Slack-formatted experiments line (`<URL|key>: cohort` or the
// already-plain `key: cohort` form) into an ADF paragraph. The leading
// `<URL|key>` chunk becomes a text node with a `link` mark so the
// experiment name renders as a clickable Hivemind link in the Jira issue
// panel — matching the Slack message behavior. Anything after the closing
// `>` is appended as a plain text node on the same paragraph.
function experimentLineToParagraph(line) {
  // `^\s*<...>` tolerates leading whitespace if the BFF ever emits indented
  // experiments_line entries — the alternative is silently dropping the
  // Hivemind hyperlink and rendering as plain text.
  const m = line.match(/^\s*<([^|>]+)\|([^>]+)>(.*)$/);
  if (m) {
    const [, url, linkText, rest] = m;
    const content = [
      {
        type: 'text',
        text: linkText,
        marks: [{ type: 'link', attrs: { href: url } }],
      },
    ];
    if (rest) content.push({ type: 'text', text: rest });
    return { type: 'paragraph', content };
  }
  return paragraph(line);
}

// Wrap experiments_line in ADF doc. Jira REST v3 requires ADF for any
// rich-text custom field — even though the field metadata advertises
// `schema.type: "string"` for `customfield_36258`, the create API rejects
// plain strings with "not valid Atlassian Document Format (ADF) content".
// One paragraph per `\n`-separated line; per-line link parsing preserves
// the experiment-name hyperlinks the BFF embeds.
function experimentsLineToAdf(s) {
  return {
    type: 'doc',
    version: 1,
    content: s.split('\n').map(experimentLineToParagraph),
  };
}

// Jira label fields (custom or system) reject values containing spaces —
// the API returns 400 "The label 'X Y' can't contain spaces." Topics in
// the feedback dialog use pretty display strings ("Publishing my site",
// "AI assistant", "Editor & design"), so collapse internal whitespace to
// a single hyphen before sending. Pretty display is preserved on the
// Slack side and in the description; the Jira label is the only place
// that has to slugify.
function topicToLabel(topic) {
  return String(topic).trim().replace(/\s+/g, '-');
}

// 0/7 IS a valid option in the AABSP Rating select. The fanout
// `rating < 5` gate doesn't exclude 0, so a rating=0 row legitimately
// produces a Prod Feedback ticket with `{value: "0/7"}`. Rejecting it
// would silently drop the rating signal from a worst-NPS submission.
// (Source of truth for valid options is the live AABSP project
// metadata — `getJiraIssueTypeMetaWithFields` against issue-type
// "Prod Feedback" returns the full `0/7`..`7/7` allowedValues set.)
function ratingOption(rating) {
  if (rating == null) return null;
  const n = Number(rating);
  if (!Number.isInteger(n) || n < 0 || n > 7) return null;
  return { value: `${n}/7` };
}

// Description holds the raw feedback text only — rendered as prose
// paragraphs, one per line. Customer ID, app ID, origin, topics,
// subscription, experiments, rating, and S3 reference now live on the
// typed custom fields; duplicating them here would clutter the issue
// panel and drift over time.
//
// Why paragraphs (not codeBlock): codeBlock renders in a monospace frame
// suited for source code. Customer-typed feedback is prose, so the code
// frame looks wrong. Splitting on `\n` keeps the original line breaks
// visible without pretending the content is code.
//
// When feedback_text is empty the description is an empty `doc` ADF —
// the typed fields and the summary fallback carry the context.
function buildDescriptionAdf(row) {
  const content = [];
  const text = (row.feedback_text ?? '').trim();
  if (text) {
    for (const line of text.split('\n')) {
      content.push(paragraph(line));
    }
  }
  return { type: 'doc', version: 1, content };
}

function buildLabels(_row) {
  return ['AAB-App'];
}

/**
 * Assemble the typed custom-field portion of the create body. Absent values
 * are omitted entirely (rather than sent as null/empty) — Jira treats some
 * empty primitives as "set to empty string" which clutters the issue panel.
 */
function buildCustomFields(row, s3Ref) {
  const fields = {
    // atlassian-team custom field uses an asymmetric payload: reads echo
    // back the resolved object `{id, name, avatarUrl, ...}` but writes
    // require the plain string UUID. Sending `{id: "<uuid>"}` here was
    // rejected by REST v3 with
    //   "Team id '{id=StringValue[value=...]}' is not valid."
    // because Jira's create-issue parser treats the whole object as the
    // attempted team id rather than unwrapping it. The server resolves
    // the UUID into the displayed name + avatar before rendering the
    // Team chip on the issue panel.
    [CUSTOM_FIELD_IDS.team]: AIRO_ENGINEERING_SUPPORT_TEAM_ID,
  };

  if (row.app_id) fields[CUSTOM_FIELD_IDS.appId] = row.app_id;
  if (row.feedback_id) fields[CUSTOM_FIELD_IDS.feedbackId] = row.feedback_id;
  if (row.subscription_info) fields[CUSTOM_FIELD_IDS.subscriptionPlan] = row.subscription_info;
  if (row.feedback_origin_name) fields[CUSTOM_FIELD_IDS.origin] = row.feedback_origin_name;

  const topics = parseTopics(row.feedback_topic_list)
    .map(topicToLabel)
    .filter((s) => s.length > 0);
  if (topics.length > 0) fields[CUSTOM_FIELD_IDS.topics] = topics;

  // Customer Consent is a multicheckbox with one allowed value "Yes" (option
  // ID 59220). Submit `[{value:"Yes"}]` only when the customer opted in;
  // omit the field entirely otherwise so the issue panel shows blank
  // instead of an empty checkbox group.
  if (row.consent_flag === true) {
    fields[CUSTOM_FIELD_IDS.customerConsent] = [{ value: 'Yes' }];
  }

  if (s3Ref) fields[CUSTOM_FIELD_IDS.s3ObjectReference] = s3Ref;

  if (row.experiments_line) {
    fields[CUSTOM_FIELD_IDS.experiments] = experimentsLineToAdf(row.experiments_line);
  }

  // Rating is the only Prod-Feedback-exclusive field — Bug / SOS Support
  // don't expose it on the create form. Restrict to the feedback category
  // even though the gate would catch it, so a misrouted row doesn't 400.
  if (row.feedback_category === 'feedback') {
    const opt = ratingOption(row.rating);
    if (opt) fields[CUSTOM_FIELD_IDS.rating] = opt;
  }

  return fields;
}

/**
 * @param {object} row - parquet feedback row
 * @param {string} projectKey - AABSP or other Atlassian project key
 * @param {string} [s3Ref] - `s3://<bucket>/<key>` for the source parquet file
 */
export function buildJiraIssueBody(row, projectKey, s3Ref) {
  return {
    fields: {
      project: { key: projectKey },
      issuetype: { name: issueTypeName(row.feedback_category) },
      summary: buildSummary(row),
      description: buildDescriptionAdf(row),
      labels: buildLabels(row),
      ...buildCustomFields(row, s3Ref),
    },
  };
}

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { parseFeedbackParquet } from './parquet-reader.mjs';
import { keyFor, readState, writeStateConditional } from './state.mjs';
import { postCase, getCase, postNote } from './crm-client.mjs';
import { invokeInvestigator } from './invoke-investigator.mjs';
import { postSlackMessage } from './slack.mjs';
import { findIssueByFeedbackId, createIssue } from './jira-client.mjs';
import { buildJiraIssueBody } from './jira-mapping.mjs';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const s3 = new S3Client({ region: REGION });

const DEDUP_WINDOW_MS = 60 * 60 * 1000;
const SCHEMA_VERSION = 1;

const log = (level, domain, fields) => {
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({
    level,
    msg: domain,
    ...fields,
  }));
};

/**
 * S3 ObjectCreated event handler. Processes one parquet at a time.
 *
 * Flag-gated entry: the BFF stamps `fanout_via_lambda` into the parquet row
 * at submit time based on the `appbuilder-fanout-via-lambda` Switchboard
 * flag. When that field is not strictly `true`, this handler exits clean
 * without touching anything — the BFF/UI owns the fanout (legacy path).
 * Per-submission gating avoids the Lambda needing its own switchboard
 * client + IAM grant, and gives an atomic flip per submission.
 *
 * Scope note: only NPS feedback writes parquet today, so only the NPS
 * path can be flag-ON. Issue/support submissions continue through their
 * existing CRM endpoint regardless. PR #3946 widens parquet writes to all
 * categories, after which the same gate applies uniformly.
 */
export async function handler(event) {
  const record = event.Records?.[0];
  if (!record?.s3) {
    log('warn', 'fanout.event.bad_shape', {});
    return;
  }
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

  log('info', 'fanout.start', { bucket, key });

  const parquetBytes = await readParquet(bucket, key);
  const row = await parseFeedbackParquet(parquetBytes);

  // Per-submission Switchboard gate, stamped by the BFF in
  // `app/src/app/api/feedback/s3-store/route.ts`. We check immediately
  // after parsing the row and before any dedup/CRM/Slack/invoke work so
  // legacy submissions trigger zero side effects in the Lambda.
  if (row.fanout_via_lambda !== true) {
    log('info', 'fanout.disabled', {
      reason: 'fanout_via_lambda flag false in parquet',
      customerId: row.customer_id ?? null,
      appId: row.app_id ?? null,
    });
    return;
  }

  const customerId = row.customer_id;
  const appId = row.app_id;
  const submissionId = row.feedback_id;
  if (!customerId || !appId || !submissionId) {
    log('warn', 'fanout.row.missing_required', { hasCustomer: !!customerId, hasApp: !!appId, hasSubmissionId: !!submissionId });
    return;
  }

  const stateBucket = process.env.FEEDBACK_BUCKET ?? bucket;
  const existing = await readState({ bucket: stateBucket, customerId, appId });

  const now = Date.now();
  if (existing) {
    const age = now - existing.state.startedAt;
    if (age <= DEDUP_WINDOW_MS) {
      const handled = await handleDedupHit({
        existing, row, customerId, appId, submissionId, stateBucket, now,
      });
      if (handled) return;
      // handleDedupHit returned false: existing case is stale (closed) OR
      // getCase failed transiently OR existing.crmCaseId is null (prior
      // submission's CRM postCase failed under bulkhead). Fall through to
      // handleFreshPath which overwrites state with IfMatch using the
      // existing etag (instead of IfNoneMatch:'*' which would 412 and
      // silently drop the fanout). Preserve `startedAt` from the existing
      // state so the 60-min dedup window stays anchored to the FIRST
      // submission — without this, a customer hammering submit while CRM
      // is down would re-anchor `startedAt` on every retry, defeating the
      // dedup contract.
      await handleFreshPath({
        row, customerId, appId, submissionId, stateBucket, now,
        overwriteEtag: existing.etag,
        preservedStartedAt: existing.state.startedAt,
      });
      return;
    }
  }

  await handleFreshPath({ row, customerId, appId, submissionId, stateBucket, now });
}

async function readParquet(bucket, key) {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const stream = result.Body;
  const bytes = await stream.transformToByteArray();
  return Buffer.from(bytes);
}

function buildExternalSystemId(customerId, appId, submissionId) {
  return `airo-${customerId}-${appId ?? 'na'}-${submissionId}`;
}

function buildInvestigateUrl(customerId, appId) {
  const base = process.env.DEBUG_CONSOLE_BASE_URL;
  if (!base) return null;
  const ctx = Buffer.from(JSON.stringify({ c: customerId, a: appId, t: 'investigate' }), 'utf-8').toString('base64url');
  return `${base.replace(/\/$/, '')}/?ctx=${ctx}`;
}

function newInvestigationId() {
  const ts = new Date().toISOString().slice(0, 10);
  const r = Math.random().toString(36).slice(2, 10);
  return `inv-${ts}-${r}`;
}

function crmConfig() {
  // crm-token.mjs reads CRM_CERT_SECRET_ARN / CRM_KEY_SECRET_ARN /
  // AIRO_SSO_ENDPOINT from process.env directly (matches investigator
  // pattern's mTLS via Node `https`). Only crmBaseUrl is plumbed here.
  return {
    crmBaseUrl: process.env.CRM_BASE_URL,
  };
}

async function handleDedupHit({ existing, row, customerId, appId, submissionId, stateBucket, now }) {
  // Prior submission left state.json with no caseId (e.g. CRM postCase
  // failed → bulkhead skipped). Don't call getCase(null) — it would 500
  // server-side. Treat as stale → caller falls through to fresh path so
  // CRM gets retried on this new submission.
  if (!existing.state.crmCaseId) {
    log('info', 'fanout.dedup.no_case_id', { customerId, appId, reason: 'state.json has null crmCaseId, retry CRM via fresh path' });
    return false;
  }

  let liveCase;
  try {
    liveCase = await getCase({ ...crmConfig(), caseId: existing.state.crmCaseId });
  } catch (err) {
    log('warn', 'fanout.dedup.get_failed', { error: err.message });
    return false;
  }

  if (!liveCase || liveCase.status !== 'Open') {
    log('info', 'fanout.dedup.stale', { liveStatus: liveCase?.status, caseId: existing.state.crmCaseId });
    return false;
  }

  const note = renderDuplicateNote({ submissionId, row });
  try {
    await postNote({ ...crmConfig(), caseRecordId: existing.state.crmCaseId, note });
  } catch (err) {
    log('warn', 'fanout.dedup.note_failed', { error: err.message });
  }

  try {
    await writeStateConditional({
      bucket: stateBucket, customerId, appId,
      state: { ...existing.state, lastUpdatedAt: now },
      ifMatchEtag: existing.etag,
    });
  } catch (err) {
    if (err.name !== 'PreconditionFailed') log('warn', 'fanout.dedup.state_update_failed', { error: err.message });
  }

  // Slack always runs on dedup hit (mirrors fresh path) — every submission
  // pings the channel even when the underlying CRM case is reused, so the
  // team sees that the customer kept submitting. Failures here MUST NOT
  // block Jira / state update.
  try {
    await postSlackMessage({
      category: row.feedback_category,
      formData: buildFormDataFromRow(row),
      origin: row.feedback_origin_name ?? undefined,
      ctx: buildDiagnosticContextFromRow(row),
    });
  } catch (err) {
    log('warn', 'fanout.dedup.slack_failed', { error: err.message });
  }

  // Jira always runs on dedup hit (subject to eligibility gate). Each spam-
  // click has a unique feedback_id (UUID) so `findIssueByFeedbackId` won't
  // match across submissions; each eligible click creates its own AABSP
  // ticket. Investigator stays off on this path — only the new CRM case
  // creation is suppressed, not Slack/Jira surfacing.
  if (shouldFanoutDownstream(row)) {
    try {
      const existingIssue = await findIssueByFeedbackId({
        baseUrl: process.env.JIRA_BASE_URL,
        projectKey: process.env.JIRA_PROJECT_KEY,
        feedbackId: submissionId,
      });
      if (existingIssue) {
        log('info', 'fanout.dedup.jira.skip_existing', { issueKey: existingIssue, feedbackId: submissionId });
      } else {
        const body = buildJiraIssueBody(row, process.env.JIRA_PROJECT_KEY);
        const issue = await createIssue({ baseUrl: process.env.JIRA_BASE_URL, body });
        log('info', 'fanout.dedup.jira.created', { issueKey: issue.key, feedbackId: submissionId });
      }
    } catch (err) {
      log('warn', 'fanout.dedup.jira_failed', { error: err.message, feedbackId: submissionId });
    }
  }

  log('info', 'fanout.dedup.hit', { customerId, appId, caseId: existing.state.crmCaseId });
  return true;
}

async function handleFreshPath({ row, customerId, appId, submissionId, stateBucket, now, overwriteEtag, preservedStartedAt }) {
  const baseState = {
    schemaVersion: SCHEMA_VERSION,
    submissionId,
    crmCaseId: null,
    // Preserve the original `startedAt` when called from handleDedupHit's
    // fall-through path so the dedup window doesn't slide on every retry
    // while CRM is failing. New `now` only used when there's no prior
    // state to anchor to.
    startedAt: preservedStartedAt ?? now,
    lastUpdatedAt: now,
  };
  try {
    if (overwriteEtag) {
      // Caller already saw an existing state and decided to overwrite (stale
      // closed case, or dedup-check transient failure). IfMatch lets the
      // overwrite succeed exactly once; if a concurrent writer already moved
      // the etag the catch below resolves the race the same as the create path.
      await writeStateConditional({ bucket: stateBucket, customerId, appId, state: baseState, ifMatchEtag: overwriteEtag });
    } else {
      await writeStateConditional({ bucket: stateBucket, customerId, appId, state: baseState });
    }
  } catch (err) {
    if (err.name === 'PreconditionFailed') {
      const cur = await readState({ bucket: stateBucket, customerId, appId });
      if (!cur) throw err;
      const age = now - cur.state.startedAt;
      if (age > DEDUP_WINDOW_MS) {
        await writeStateConditional({
          bucket: stateBucket, customerId, appId, state: baseState, ifMatchEtag: cur.etag,
        });
      } else {
        log('info', 'fanout.fresh.race_lost', { customerId, appId });
        return;
      }
    } else {
      throw err;
    }
  }

  // CRM postCase — warn-not-throw, matches the bulkhead pattern used by
  // every other downstream in this Lambda (Slack, kickoff note,
  // investigator, Jira). A 4xx data error (e.g. CMAPI 422 "Missing Contact
  // Information" when Profile API can't supply email/phone) won't be fixed
  // by replay, so failing the whole handler → DLQ would just lose the
  // other fanouts that are perfectly capable of running. A 5xx transient
  // failure could be retried via AWS Lambda async, but that re-runs the
  // ENTIRE handler — duplicating Slack/Jira/investigator on each retry.
  // Both failure modes are better served by: log + continue, leave
  // caseId=null in state.json, let next submission within the dedup
  // window fall through to a fresh CRM attempt. Parquet is the source of
  // truth; manual replay from the parquet S3 event is the recovery path
  // for any genuinely-needed retry.
  // CRM new-case eligibility: issue/support open cases for support agents;
  // NPS feedback (rating-based survey) NEVER opens a case — even rating < 5.
  // Mirrors the legacy BFF contract from `/api/crm/case` which was
  // issue/support only. Without this gate every NPS submission would
  // create a case and flood the support queue with non-issues.
  let caseId = null;
  let caseNumber = null;
  if (shouldOpenCrmCase(row)) {
    try {
      const result = await postCase({
        ...crmConfig(),
        body: buildCaseBody({ row, customerId, appId, submissionId }),
      });
      caseId = result.caseId;
      caseNumber = result.caseNumber;
    } catch (err) {
      log('warn', 'fanout.crm.post_failed', { error: err.message });
    }
  } else {
    log('info', 'fanout.crm.skip', {
      reason: 'feedback category does not open CRM case',
      category: row.feedback_category,
    });
  }

  const after = await readState({ bucket: stateBucket, customerId, appId });
  if (after) {
    try {
      await writeStateConditional({
        bucket: stateBucket, customerId, appId,
        state: { ...after.state, crmCaseId: caseId, lastUpdatedAt: Date.now() },
        ifMatchEtag: after.etag,
      });
    } catch (err) {
      if (err.name !== 'PreconditionFailed') log('warn', 'fanout.fresh.state_caseId_failed', { error: err.message });
    }
  }

  // Slack delivery: builds the same Block Kit shape the UI used to build
  // (verbatim port in slack-builders.mjs / slack-format.mjs). Webhook URL
  // comes from a CDK-owned Secrets Manager secret; while unset the
  // helper silently skips. Failures here MUST NOT block CRM / investigator.
  try {
    await postSlackMessage({
      category: row.feedback_category,
      formData: buildFormDataFromRow(row),
      origin: row.feedback_origin_name ?? undefined,
      ctx: buildDiagnosticContextFromRow(row),
    });
  } catch (err) {
    log('warn', 'fanout.slack.failed', { error: err.message });
  }

  const investigateUrl = buildInvestigateUrl(customerId, appId);
  const investigationId = newInvestigationId();
  if (caseId && investigateUrl) {
    // Wording matches the legacy BFF (`/api/feedback/submit`) verbatim so
    // support tooling that triages on this exact prefix continues to work.
    try {
      await postNote({
        ...crmConfig(),
        caseRecordId: caseId,
        note: `AI investigation kicked off for this case (investigationId: ${investigationId}). Track progress: ${investigateUrl}`,
      });
    } catch (err) {
      log('warn', 'fanout.kickoff.note_failed', { error: err.message });
    }
  }

  // Investigator — same eligibility gate as Jira: issue + support always,
  // NPS feedback only when rating < 5. Skips happy NPS submissions
  // (rating >= 5) where there's no problem to investigate.
  if (shouldFanoutDownstream(row)) {
    try {
      // Payload shape mirrors the legacy BFF
      // (`app/src/lib/investigate/invoke.ts:InvestigatorInvokePayload`)
      // verbatim so the investigator Lambda's input contract is unchanged.
      // The S3 key bundle (stateKey/historyPrefix/resultKey/tracePrefix/
      // eventsPrefix) tells the investigator where to write its state.json,
      // history snapshots, terminal result.md, and per-step trace events
      // inside the investigations bucket — without these the Lambda errors
      // out on first state write.
      const safeCustomerId = encodeURIComponent(customerId);
      const safeAppId = encodeURIComponent(appId);
      const activeBase = `active/${safeCustomerId}/${safeAppId}`;
      await invokeInvestigator({
        functionName: process.env.INVESTIGATE_LAMBDA_FN,
        payload: {
          investigationId,
          appId,
          customerId,
          feedback: row.feedback_text ?? '',
          fullstoryUrl: row.full_story_url ?? null,
          timeWindow: null,
          stateKey: `${activeBase}/state.json`,
          resultKey: `${activeBase}/result.md`,
          historyPrefix: `history/${safeCustomerId}/${safeAppId}/`,
          tracePrefix: `${activeBase}/`,
          eventsPrefix: `events/${safeCustomerId}/${safeAppId}/`,
          source: 'feedback',
          category: row.feedback_category,
          ...(row.rating != null ? { rating: row.rating } : {}),
          topics: parseTopics(row.feedback_topic_list),
          ...(row.feedback_category === 'feedback' && row.consent_flag != null
            ? { customerConsent: row.consent_flag === true }
            : {}),
          ...(caseId ? { crmCaseId: caseId } : {}),
          ...(caseNumber ? { crmCaseNumber: caseNumber } : {}),
        },
      });
    } catch (err) {
      log('warn', 'fanout.invoke.failed', { error: err.message });
    }
  } else {
    log('info', 'fanout.invoke.skipped', { reason: 'category/rating not eligible', category: row.feedback_category, rating: row.rating ?? null });
  }

  // Jira fanout — gated by category eligibility, idempotent by
  // feedback-id label. Wrapped in try/catch warn-not-throw so a Jira
  // outage / token failure / 4xx does NOT roll back or block prior
  // fanouts (state, CRM, Slack, investigator). Failure mode: log and
  // move on; ops can backfill from the parquet if needed.
  if (shouldFanoutDownstream(row)) {
    try {
      const existing = await findIssueByFeedbackId({
        baseUrl: process.env.JIRA_BASE_URL,
        projectKey: process.env.JIRA_PROJECT_KEY,
        feedbackId: submissionId,
      });
      if (existing) {
        log('info', 'fanout.jira.skip_existing', { issueKey: existing, feedbackId: submissionId });
      } else {
        const body = buildJiraIssueBody(row, process.env.JIRA_PROJECT_KEY);
        const issue = await createIssue({ baseUrl: process.env.JIRA_BASE_URL, body });
        log('info', 'fanout.jira.created', { issueKey: issue.key, feedbackId: submissionId });
      }
    } catch (err) {
      log('warn', 'fanout.jira.failed', { error: err.message, feedbackId: submissionId });
    }
  }

  log('info', 'fanout.fresh.done', { customerId, appId, caseId, caseNumber, investigationId });
}

/**
 * Eligibility for downstream fanout (AABSP Jira ticket + investigator).
 *   - issue:    always
 *   - support:  always
 *   - feedback: only if rating != null && rating < 5
 *
 * Slack always runs (separate gating) because Slack mirrors all signals.
 * CRM gating lives in its own block (issue + support only).
 */
function shouldFanoutDownstream(row) {
  const cat = row.feedback_category;
  if (cat === 'issue' || cat === 'support') return true;
  if (cat === 'feedback' && row.rating != null && row.rating < 5) return true;
  return false;
}

/**
 * Eligibility for opening a NEW CRM case.
 *   - issue:    always (real customers)
 *   - support:  always (real customers)
 *   - feedback: NEVER (even rating < 5)
 *
 * Internal-user gate: GoDaddy employees have 3-char shopperIds (TLA — three
 * letter acronym). They MUST NOT open CRM cases — internal employees
 * testing the product would otherwise flood the support triage queue. PR
 * #3301 codified this contract for the legacy `/api/crm/case` route; the
 * legacy UI fanout-OFF branches in `FeedbackMultiStep.tsx` keep enforcing
 * `!isInternalUser`. The deleted `/api/feedback/submit` route enforced the
 * same with a hard 403. Lambda's `handler.buildDiagnosticContextFromRow`
 * even has a comment claiming the BFF gates internal users out before the
 * parquet write — but the new s3-store route doesn't, so this is the
 * defense-in-depth gate. Slack still runs for internal users (matches UI
 * legacy: Slack always pings); CRM is the only blocked downstream here.
 *
 * Distinct from `shouldFanoutDownstream` (which gates investigator + Jira)
 * because NPS rating < 5 still warrants AI investigation + Jira triage,
 * but should not flood the support queue with cases — survey ratings
 * aren't issues.
 */
function shouldOpenCrmCase(row) {
  if (typeof row.shopper_id === 'string' && row.shopper_id.length === 3) {
    return false;
  }
  const cat = row.feedback_category;
  return cat === 'issue' || cat === 'support';
}

/**
 * Build a CMAPI case body that matches the legacy BFF
 * (`app/src/lib/crm/case-client.ts:buildCaseBody`) shape verbatim — same
 * field set, same caseNotes structure (`Comment : (appid - <id>) <details>`),
 * same recordType/status/categories — so support agents see "Saideep
 * Kilaru / skilaru@godaddy.com / 9170...", not a raw customerId with a
 * noreply email. Profile fields come from the parquet (BFF best-effort
 * fetched them via Profile API at submit time); when unavailable we fall
 * back to safe nulls/customerId rather than blocking the case.
 */
function buildCaseBody({ row, customerId, appId, submissionId }) {
  const text = row.feedback_text ?? '';
  const truncatedDescription = text.slice(0, 4000);
  const escalationDetails = buildEscalationDetails({ row, truncatedDescription });
  const appIdSegment = appId ? `(appid - ${appId}) ` : '';
  const note = `Comment : ${appIdSegment}${escalationDetails}`;

  const firstName = row.customer_first_name ?? '';
  const lastName = row.customer_last_name ?? '';
  const fullName = `${firstName} ${lastName}`.trim();

  const body = {
    contactName: fullName || customerId,
    contactFirstName: firstName || null,
    contactLastName: lastName || null,
    contactEmail: row.customer_email ?? null,
    shopperId: row.shopper_id ?? null,
    recordType: 'standard',
    status: 'Open',
    caseOrigin: 'Automation',
    primaryCategory: 'Websites',
    secondaryCategory: 'Airo AI Builder',
    issue: 'General Support',
    externalSystemId: buildExternalSystemId(customerId, appId, submissionId),
    caseNotes: [
      {
        note,
        noteType: 'Status Change',
        noteTypeDetails: 'Escalation',
      },
    ],
    additionalData: {
      permissionToMakeChanges: 'true',
      severity: 'S2',
      escalated: 'true',
      type: 'Complete',
      escalationDetails,
    },
  };

  if (row.customer_phone) {
    body.contactPhone = row.customer_phone;
  }

  return body;
}

/**
 * Mirrors the legacy BFF's `buildEscalationDetails`
 * (`app/src/lib/crm/case-client.ts`) verbatim — same `[ISSUE]` /
 * `[SUPPORT]` / `[FEEDBACK NPS <n> | consent=yes|no]` prefixes, same
 * `Topics: a, b, c` capitalization, same `consent=yes` / `consent=no`
 * markers — so support tooling that triages on these literals continues
 * to work without re-training.
 */
function buildEscalationDetails({ row, truncatedDescription }) {
  const cat = row.feedback_category;
  const topics = parseTopics(row.feedback_topic_list);
  const topicsLine = topics.length > 0 ? ` | Topics: ${topics.join(', ')}` : '';
  if (cat === 'issue') return `[ISSUE] ${truncatedDescription}`;
  if (cat === 'support') {
    return `[SUPPORT] ${truncatedDescription}${topicsLine}`;
  }
  // feedback (NPS)
  const consentMarker = row.consent_flag === true ? 'consent=yes' : 'consent=no';
  const ratingLabel = row.rating ?? 'unknown';
  return `[FEEDBACK NPS ${ratingLabel} | ${consentMarker}] ${truncatedDescription}${topicsLine}`;
}

function renderDuplicateNote({ submissionId, row }) {
  return [
    'Duplicate submission within 60-min window.',
    `SubmissionId: ${submissionId}`,
    `Category: ${row.feedback_category ?? 'unknown'}`,
    row.rating != null ? `Rating: ${row.rating}` : null,
    `Feedback: ${(row.feedback_text ?? '').slice(0, 1000)}`,
  ].filter(Boolean).join('\n');
}

function parseTopics(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

/**
 * Reconstruct the form-data shape the UI used to pass to slackBuilders.
 * Categories: 'feedback' (rating + comment + customerConsent),
 * 'issue' / 'support' (description + followUp).
 *
 * Driven by `row.feedback_category` — distinct from `row.feedback_origin_name`
 * which holds the UI surface label (e.g. 'first-publish-banner').
 */
function buildFormDataFromRow(row) {
  const topics = parseTopics(row.feedback_topic_list);
  const followUp = row.consent_flag === true;
  const text = row.feedback_text ?? '';
  if (row.feedback_category === 'feedback') {
    return {
      rating: row.rating ?? null,
      topics,
      comment: text,
      customerConsent: row.consent_flag === true,
    };
  }
  // issue or support
  return { topics, description: text, followUp };
}

/**
 * Reconstruct DiagnosticContext from parquet fields written by the BFF.
 * `isInternalUser` is derived from shopper_id length (3-char = TLA). The
 * BFF does NOT pre-filter internal users from the parquet write — that
 * was the contract on the deleted `/api/feedback/submit` route; the new
 * s3-store route writes for everyone (internal users still need their
 * NPS feedback / parquet rows captured for analytics). Internal-user
 * downstream gating happens at `shouldOpenCrmCase` so CRM never gets
 * employee-test-traffic cases. Slack still pings for everyone.
 *
 * `isImpersonating` (e2s — employee impersonation): there's no parquet
 * column for it today and the BFF route doesn't preserve it. Set false
 * for now; widening parquet schema with `auth_type` is a follow-up.
 */
function buildDiagnosticContextFromRow(row) {
  const shopperId = typeof row.shopper_id === 'string' ? row.shopper_id : undefined;
  return {
    currentAppId: row.app_id ?? null,
    previewUrl: row.preview_url || undefined,
    publishedUrl: row.published_url_full || undefined,
    fullStoryUrl: row.full_story_url ?? null,
    subscriptionInfo: row.subscription_info ?? '',
    planType: null,
    subscriptionId: row.subscription_id ?? null,
    subscriptionStatus: row.subscription_status ?? null,
    totalCredits: row.total_credit_cnt ?? null,
    availableCredits: row.available_credit_cnt ?? null,
    isInternalUser: shopperId?.length === 3,
    isImpersonating: false,
    shopperId,
    experimentsLine: row.experiments_line || undefined,
  };
}

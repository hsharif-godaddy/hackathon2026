import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { parseFeedbackParquet } from './parquet-reader.mjs';
import { readState, writeStateConditional } from './state.mjs';
import { postCase, getCase, getCaseByExternalId, postNote, resolveCaseAsync } from './crm-client.mjs';
import { invokeInvestigator } from './invoke-investigator.mjs';
import { postSlackMessage } from './slack.mjs';
import { findIssueByFeedbackId, createIssue } from './jira-client.mjs';
import { buildJiraIssueBody, parseTopics } from './jira-mapping.mjs';
import { log } from './logger.mjs';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const s3 = new S3Client({ region: REGION });

const DEDUP_WINDOW_MS = 60 * 60 * 1000;
const SCHEMA_VERSION = 1;


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
  // Source-parquet S3 URI threaded into the Jira "S3 Object Reference"
  // custom field (customfield_36259) so triagers can replay the raw payload
  // when needed. Built once here and passed down through the dedup-hit and
  // fresh paths.
  const s3Ref = `s3://${bucket}/${key}`;
  const existing = await readState({ bucket: stateBucket, customerId, appId });

  const now = Date.now();
  if (existing) {
    const age = now - existing.state.startedAt;
    if (age <= DEDUP_WINDOW_MS) {
      const handled = await handleDedupHit({
        existing, row, customerId, appId, submissionId, stateBucket, now, s3Ref,
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
        row, customerId, appId, submissionId, stateBucket, now, s3Ref,
        overwriteEtag: existing.etag,
        preservedStartedAt: existing.state.startedAt,
      });
      return;
    }
  }

  await handleFreshPath({ row, customerId, appId, submissionId, stateBucket, now, s3Ref });
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

async function handleDedupHit({ existing, row, customerId, appId, submissionId, stateBucket, now, s3Ref }) {
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

  // Jira runs BEFORE Slack so the duplicate-Slack message can include the
  // newly created AABSP ticket as a triage link. Eligibility-gated; each
  // spam-click has a unique submissionId so the find-by-label search won't
  // match a prior click — each eligible click creates its own ticket.
  // Investigator stays off on dedup path — only NEW CRM case creation +
  // investigator are suppressed; Slack/Jira still surface every submission.
  const jiraKey = await resolveJiraKey({ row, submissionId, logPrefix: 'fanout.dedup.jira', s3Ref });

  // Slack always runs on dedup hit (mirrors fresh path) — every submission
  // pings the channel even when the underlying CRM case is reused. Now
  // enriched with triage links: the existing CRM case (reused) and the
  // new Jira ticket (one per click). Failures here MUST NOT block state
  // update.
  try {
    await postSlackMessage({
      category: row.feedback_category,
      formData: buildFormDataFromRow(row),
      origin: row.feedback_origin_name ?? undefined,
      ctx: buildDiagnosticContextFromRow(row),
      enrichment: buildEnrichment({
        // liveCase is the resolved CMAPI Case from the dedup-path getCase
        // above. `caseRecordId` is populated whenever the row exists in
        // SF; `caseNumber` may lag during the SF projection's mid-write
        // window (rare on dedup since we're reading an older row, but
        // defended for robustness), hence the `?? null` fallback.
        caseRecordId: liveCase.caseRecordId,
        caseNumber: liveCase.caseNumber ?? null,
        jiraKey,
      }),
    });
  } catch (err) {
    log('warn', 'fanout.dedup.slack_failed', { error: err.message });
  }

  log('info', 'fanout.dedup.hit', { customerId, appId, caseId: existing.state.crmCaseId, jiraKey });
  return true;
}

async function handleFreshPath({ row, customerId, appId, submissionId, stateBucket, now, s3Ref, overwriteEtag, preservedStartedAt }) {
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
  // NPS feedback (rating-based survey) NEVER opens a case — even rating < 7.
  // Mirrors the legacy BFF contract from `/api/crm/case` which was
  // issue/support only. Without this gate every NPS submission would
  // create a case and flood the support queue with non-issues.
  let caseId = null;
  let caseNumber = null;
  let caseRecordId = null;
  if (shouldOpenCrmCase(row)) {
    const externalSystemId = buildExternalSystemId(customerId, appId, submissionId);
    try {
      // Pre-POST idempotency guard: if a case with this externalSystemId
      // already exists, reuse it instead of POSTing again. Defends against
      // scenarios where postCase appears to fail to us (30s client abort,
      // network blip, manual parquet replay) but CMAPI server-side already
      // persisted the case. Without this guard, the next attempt would
      // create a duplicate. Cheap (~500ms p99 GET per fresh path) and only
      // runs on the fresh path — dedup hits already short-circuited above.
      const existing = await getCaseByExternalId({
        ...crmConfig(),
        externalId: externalSystemId,
      }).catch((err) => {
        log('warn', 'fanout.crm.preflight_get_failed', {
          customerId, appId, submissionId, externalSystemId, error: err.message,
        });
        return null;
      });
      if (existing?.caseRecordId) {
        caseRecordId = existing.caseRecordId;
        caseNumber = existing.caseNumber ?? null;
        caseId = existing.caseRecordId;
        log('info', 'fanout.crm.preflight_hit', {
          customerId, appId, submissionId, caseId, caseNumber,
        });
      } else {
        // externalSystemId is constructed inside buildCaseBody and echoed back
        // by CMAPI as `referenceId` on the async path; we read it from there.
        const result = await postCase({
          ...crmConfig(),
          body: buildCaseBody({ row, customerId, appId, submissionId }),
        });
        caseId = result.caseId;
        caseNumber = result.caseNumber;
        // Two paths depending on whether CMAPI responded sync or async:
        //
        // Async (CMAPI 202): POST returns only `referenceId` (our externalSystemId
        // echoed back). caseId/caseNumber null until SF Adapter persists the case.
        // Poll GET ?externalId= with backoff to materialise the real SF Record ID
        // + customer-facing caseNumber for the Slack Lightning link.
        //
        // Sync (CMAPI 200): POST returns `id` (real SF Record ID) in `caseId`.
        // caseNumber is NOT in the POST response on either path — CMAPI docs
        // confirm caseNumber comes only from a subsequent GET. So on the sync
        // path we set caseRecordId directly from caseId, then do a single GET
        // ?caseId= to fetch caseNumber (no polling needed, case already exists).
        if (result.referenceId) {
          // Async path — poll until SF persists.
          const resolved = await resolveCaseAsync({
            ...crmConfig(),
            externalId: result.referenceId,
            log,
            context: { customerId, appId, submissionId },
          });
          if (resolved) {
            caseRecordId = resolved.caseRecordId;
            caseNumber = resolved.caseNumber;
            if (!caseId) caseId = resolved.caseRecordId;
          }
        } else if (caseId) {
          // Sync path — caseId is already the SF Record ID.
          caseRecordId = caseId;
          // caseNumber not in POST response; single GET to fetch it.
          try {
            const liveCase = await getCase({ ...crmConfig(), caseId });
            caseNumber = liveCase?.caseNumber ?? null;
          } catch (err) {
            log('warn', 'fanout.crm.case_number_fetch_failed', {
              caseId, customerId, appId, submissionId, error: err.message,
            });
          }
        }
      }
    } catch (err) {
      log('warn', 'fanout.crm.post_failed', {
        customerId, appId, submissionId, error: err.message,
      });
    }
  } else {
    log('info', 'fanout.crm.skip', {
      reason: 'feedback category does not open CRM case',
      category: row.feedback_category,
    });
  }

  // Persist crmCaseId IMMEDIATELY after CRM resolution, before Slack/Jira/
  // investigator run. Tightens the dedup race window: if the handler errors
  // mid-flight (Slack 5xx, Jira 401, investigator invoke fail) AWS will not
  // retry under retryAttempts=0, but a manual DLQ replay or a spam-click
  // submission within DEDUP_WINDOW_MS will see the persisted caseId and
  // dedup-hit instead of opening a duplicate case.
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

  // Jira fanout runs BEFORE Slack so the Slack message can include the
  // AABSP issue key as a clickable triage link. Eligibility-gated and
  // idempotent (find-by-Feedback-ID before create — see jira-client.mjs
  // findIssueByFeedbackId, which JQL-searches the field defined by
  // FEEDBACK_ID_CUSTOM_FIELD_ID); each spam-click within the dedup window
  // is a unique submissionId so each click → unique Feedback ID →
  // distinct ticket. Wrapped warn-not-throw inside `resolveJiraKey` so a
  // Jira outage doesn't block Slack/investigator.
  const jiraKey = await resolveJiraKey({ row, submissionId, logPrefix: 'fanout.jira', s3Ref });

  const investigateUrl = buildInvestigateUrl(customerId, appId);
  const investigationId = newInvestigationId();

  // Slack delivery: builds the same Block Kit shape the UI used to build
  // (verbatim port in slack-builders.mjs / slack-format.mjs). Webhook URL
  // comes from a CDK-owned Secrets Manager secret; while unset the
  // helper silently skips. Now enriched with triage links: CRM case in
  // Salesforce Lightning, AABSP Jira issue, and AI investigation page.
  // Each link rendered only when corresponding entity exists. Triagers
  // can click straight from Slack to the right system.
  try {
    await postSlackMessage({
      category: row.feedback_category,
      formData: buildFormDataFromRow(row),
      origin: row.feedback_origin_name ?? undefined,
      ctx: buildDiagnosticContextFromRow(row),
      enrichment: buildEnrichment({ caseRecordId, caseNumber, jiraKey }),
    });
  } catch (err) {
    log('warn', 'fanout.slack.failed', { error: err.message });
  }

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
  // NPS feedback only when rating < 7. Skips happy NPS submissions
  // (rating >= 7) where there's no problem to investigate.
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

  log('info', 'fanout.fresh.done', { customerId, appId, caseId, caseNumber, jiraKey, investigationId });
}

/**
 * Resolve the AABSP Jira issue key for a feedback submission, creating
 * a new ticket only when one doesn't already exist for this submissionId
 * in the typed Feedback ID custom field (FEEDBACK_ID_CUSTOM_FIELD_ID in
 * jira-client.mjs — currently `cf[36238]`). Returns the issue key or
 * `null` (eligibility-gated, find/create failed, or Jira not in use).
 *
 * Wraps the find/create round-trip in a single try/catch so a Jira
 * outage degrades cleanly to `null` — Slack still posts, just without
 * the Jira link. Used by both `handleFreshPath` and `handleDedupHit`.
 * `logPrefix` selects the lifecycle namespace (`fanout.jira` for
 * fresh, `fanout.dedup.jira` for dedup) so log queries keep working
 * unchanged from before this helper existed.
 */
async function resolveJiraKey({ row, submissionId, logPrefix, s3Ref }) {
  if (!shouldFanoutDownstream(row)) return null;

  // Explicit env-presence check matches the JIRA_PROJECT_KEY regex-rejection
  // path: a missing JIRA_BASE_URL would otherwise produce a fetch error
  // like "fetch failed: undefined/rest/api/3/..." which is opaque to
  // triagers staring at CloudWatch. Surface the misconfig as a distinct
  // log line and bail to `null` so Slack/CRM/investigator continue.
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    log('warn', `${logPrefix}.config_missing`, { reason: 'JIRA_BASE_URL not set', feedbackId: submissionId });
    return null;
  }

  // Split find vs create error handling so a Jira outage and an
  // operator-side failure (project archived, required field added,
  // perms revoked) log distinctly. Find failures roll up to
  // `<prefix>.find_failed`; create failures to `<prefix>.create_failed`.
  let existing;
  try {
    existing = await findIssueByFeedbackId({
      baseUrl,
      projectKey: process.env.JIRA_PROJECT_KEY,
      feedbackId: submissionId,
    });
  } catch (err) {
    log('warn', `${logPrefix}.find_failed`, { error: err.message, feedbackId: submissionId });
    return null;
  }
  if (existing) {
    log('info', `${logPrefix}.skip_existing`, { issueKey: existing, feedbackId: submissionId });
    return existing;
  }
  try {
    const body = buildJiraIssueBody(row, process.env.JIRA_PROJECT_KEY, s3Ref);
    const issue = await createIssue({ baseUrl, body });
    log('info', `${logPrefix}.created`, { issueKey: issue.key, feedbackId: submissionId });
    return issue.key ?? null;
  } catch (err) {
    log('warn', `${logPrefix}.create_failed`, { error: err.message, feedbackId: submissionId });
    return null;
  }
}

/**
 * Build the triage-links enrichment object passed to the Slack builder.
 * Each link rendered only when the corresponding entity AND its base URL
 * env var exist, so happy NPS submissions (no CRM, no Jira) get an
 * unenriched Slack message identical to today's. Salesforce Lightning
 * base URL comes from `SALESFORCE_LIGHTNING_BASE` (set by CDK per env);
 * when unset, the CRM link is omitted entirely and the Slack message
 * still renders the rest of its contents.
 *
 * Note: investigation URL is intentionally NOT included — the
 * investigator already posts its own CRM case note with the deep link
 * (see `maybeAddCrmCaseNote` in `investigator/handler.mjs`), and the
 * kickoff note in handleFreshPath also surfaces it. Adding it to Slack
 * would be a third copy of the same link without a Slack-specific
 * triage value-add.
 */
function buildEnrichment({ caseRecordId, caseNumber, jiraKey }) {
  const sfBase = process.env.SALESFORCE_LIGHTNING_BASE;
  const jiraBase = process.env.JIRA_BASE_URL;
  const enrichment = {};
  if (caseRecordId) {
    if (sfBase) {
      enrichment.crmCaseUrl = `${sfBase.replace(/\/$/, '')}/lightning/r/Case/${caseRecordId}/view`;
      // Customer-facing case number — drives the Slack link text
      // (`Case #00012345`) so triagers see the same identifier the
      // customer received in their CRM email. Falls back to a plain
      // `Case` label inside `buildTriageLinks` when caseNumber is null
      // (resolver miss on async path; SF hasn't persisted yet).
      if (caseNumber) enrichment.caseNumber = caseNumber;
    } else {
      // CRM case exists but the Lightning base is missing from the env →
      // misconfig. Drop the link silently to avoid 500-ing the Slack post,
      // but emit a warn so dashboards/oncall can spot the regression.
      log('warn', 'fanout.enrichment.salesforce_base_missing', { caseRecordId });
    }
  }
  if (jiraKey) {
    if (jiraBase) {
      enrichment.jiraKey = jiraKey;
      enrichment.jiraUrl = `${jiraBase.replace(/\/$/, '')}/browse/${jiraKey}`;
    } else {
      log('warn', 'fanout.enrichment.jira_base_missing', { jiraKey });
    }
  }
  return Object.keys(enrichment).length > 0 ? enrichment : null;
}

/**
 * Eligibility for downstream fanout (AABSP Jira ticket + investigator).
 *   - issue:    always
 *   - support:  always
 *   - feedback: only if rating != null && rating < 7
 *
 * Slack always runs (separate gating) because Slack mirrors all signals.
 * CRM gating lives in its own block (issue + support only).
 */
function shouldFanoutDownstream(row) {
  const cat = row.feedback_category;
  if (cat === 'issue' || cat === 'support') return true;
  if (cat === 'feedback' && row.rating != null && row.rating < 7) return true;
  return false;
}

/**
 * Eligibility for opening a NEW CRM case.
 *   - issue:    always (real customers)
 *   - support:  always (real customers)
 *   - feedback: NEVER (even rating < 7)
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
 * because NPS rating < 7 still warrants AI investigation + Jira triage,
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
    customerId: row.customer_id || undefined,
    feedbackUuid: row.feedback_id || undefined,
  };
}

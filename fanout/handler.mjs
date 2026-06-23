import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { parseFeedbackParquet } from './parquet-reader.mjs';
import { readState, writeStateConditional } from './state.mjs';
import { postCase, getCase, getCaseByExternalId, postNote, resolveCaseAsync, findEscalatedCases } from './crm-client.mjs';
import { postSlackMessage } from './slack.mjs';
import { findIssueByFeedbackId, createIssue } from './jira-client.mjs';
import { buildJiraIssueBody, parseTopics } from './jira-mapping.mjs';
import { shouldCreateJiraTicket } from './jira-eligibility.mjs';
import { log } from './logger.mjs';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const s3 = new S3Client({ region: REGION });

// Bumped to 2 when state gained crmCaseNumber + escalatedCrmCaseId and the
// 1-hour dedup window was replaced by open/closed-status dedup. Legacy v1
// state (no escalatedCrmCaseId) safely falls through to the fresh path on the
// next submission, which recaptures the escalated case and rewrites as v2.
const SCHEMA_VERSION = 2;

// SF auto-escalation copies the standard case's secondaryCategory onto the
// escalated child, so we scope escalated-case lookups to ours. CMAPI has no
// secondaryCategory query param, so this filter is applied client-side.
const AIRO_SECONDARY_CATEGORY = 'Airo AI Builder';

// Escalated-case capture poll schedule (ms). SF creates the escalated child
// asynchronously after the standard case lands; mirror resolveCaseAsync's
// backoff. First attempt fires immediately, worst case ~3.5s.
const ESCALATED_CAPTURE_DELAYS = [0, 500, 1000, 2000];


/**
 * S3 ObjectCreated event handler. Processes one parquet at a time.
 *
 * Every parquet the BFF writes is fanned out here: the BFF async-invokes
 * this Lambda immediately after the S3 write (GD's permissions boundary
 * denies s3:PutBucketNotification, so there is no bucket-notification
 * trigger). All feedback categories (issue/support/feedback) write parquet
 * and fan out through this handler.
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
  // Status-based dedup (replaces the old 1-hour window): if we have a prior
  // state with an escalated case that is STILL OPEN, this submission updates
  // that case instead of opening a new one — no matter how long ago the
  // original was. A new case is opened only once the escalated case closes.
  if (existing) {
    const handled = await handleDedupHit({
      existing, row, customerId, appId, submissionId, stateBucket, now, s3Ref,
    });
    if (handled) return;
    // handleDedupHit returned false: escalated case is closed, was never
    // captured (legacy v1 state / prior capture miss), or getCase failed
    // transiently. Fall through to handleFreshPath, overwriting state with
    // IfMatch on the existing etag (IfNoneMatch:'*' would 412 and drop the
    // fanout). A new standard case is opened and its escalated child captured.
    await handleFreshPath({
      row, customerId, appId, submissionId, stateBucket, now, s3Ref,
      overwriteEtag: existing.etag,
    });
    return;
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

function crmConfig() {
  // crm-token.mjs reads CRM_CERT_SECRET_ARN / CRM_KEY_SECRET_ARN /
  // AIRO_SSO_ENDPOINT from process.env directly (mTLS via Node `https`).
  // Only crmBaseUrl is plumbed here.
  return {
    crmBaseUrl: process.env.CRM_BASE_URL,
  };
}

// A CMAPI case is "open" iff isClosed === false. We MUST gate on isClosed,
// NOT status === 'Open': escalated cases carry workflow statuses like
// "Waiting for Risk" / "Waiting for Customer" and are never literally "Open",
// so a status check would treat every open escalated case as closed and open
// a duplicate on every repeat submission.
function isCaseOpen(c) {
  return c?.isClosed === false;
}

async function handleDedupHit({ existing, row, customerId, appId, submissionId, stateBucket, now, s3Ref }) {
  // We dedup onto the ESCALATED case (that's the one L2 works). If we never
  // captured it — legacy v1 state, or the capture missed on the original
  // submission — fall through to the fresh path so a new case is opened and
  // its escalated child captured.
  const escalatedCaseId = existing.state.escalatedCrmCaseId;
  if (!escalatedCaseId) {
    log('info', 'fanout.dedup.no_escalated_case', { customerId, appId, reason: 'no escalatedCrmCaseId in state, open fresh case' });
    return false;
  }

  let liveEscalated;
  try {
    liveEscalated = await getCase({ ...crmConfig(), caseId: escalatedCaseId });
  } catch (err) {
    log('warn', 'fanout.dedup.get_failed', { error: err.message });
    return false;
  }

  if (!isCaseOpen(liveEscalated)) {
    // Closed (or missing) → a new case must be opened. Log the raw status so
    // we can diagnose if CMAPI ever omits isClosed on this route.
    log('info', 'fanout.dedup.stale', {
      escalatedCaseId, isClosed: liveEscalated?.isClosed ?? null, liveStatus: liveEscalated?.status ?? null,
    });
    return false;
  }

  const note = renderDuplicateNote({ submissionId, appId, row });
  // The note is the durable record of the follow-up on the escalated case;
  // track whether it actually landed so the dedup.hit log distinguishes a
  // clean dedup from one where the note was dropped (CMAPI blip).
  let noteOk = true;
  try {
    await postNote({ ...crmConfig(), caseRecordId: escalatedCaseId, note });
  } catch (err) {
    noteOk = false;
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
  // newly created AABSP ticket as a triage link. Eligibility-gated
  // (shouldCreateJiraTicket); each spam-click has a unique submissionId so
  // the find-by-Feedback-ID search won't match a prior click — each eligible
  // click creates its own ticket. Only NEW CRM case creation is suppressed on
  // the dedup path; Slack/Jira still surface every submission.
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
      // Link the ESCALATED case we just noted (from the live status-check
      // fetch) — that's where L2 works it. Fall back to the stored standard
      // case if the live object somehow lacks its record id. Keep id+number
      // paired to the SAME case: when we link the escalated record we label
      // with its number (or none on an SF mid-write), never mix the escalated
      // link with the standard number.
      enrichment: buildEnrichment(
        liveEscalated.caseRecordId
          ? { caseRecordId: liveEscalated.caseRecordId, caseNumber: liveEscalated.caseNumber ?? null, jiraKey }
          : { caseRecordId: existing.state.crmCaseId ?? null, caseNumber: existing.state.crmCaseNumber ?? null, jiraKey },
      ),
    });
  } catch (err) {
    log('warn', 'fanout.dedup.slack_failed', { error: err.message });
  }

  log('info', 'fanout.dedup.hit', { customerId, appId, escalatedCaseId, noteOk, jiraKey });
  return true;
}

async function handleFreshPath({ row, customerId, appId, submissionId, stateBucket, now, s3Ref, overwriteEtag }) {
  const baseState = {
    schemaVersion: SCHEMA_VERSION,
    submissionId,
    crmCaseId: null,
    crmCaseNumber: null,
    escalatedCrmCaseId: null,
    lastUpdatedAt: now,
  };
  try {
    if (overwriteEtag) {
      // Caller already saw an existing state and decided to overwrite (closed
      // escalated case, missing escalated id, or dedup-check transient
      // failure). IfMatch lets the overwrite succeed exactly once; a concurrent
      // writer moving the etag is resolved as a lost race below.
      await writeStateConditional({ bucket: stateBucket, customerId, appId, state: baseState, ifMatchEtag: overwriteEtag });
    } else {
      await writeStateConditional({ bucket: stateBucket, customerId, appId, state: baseState });
    }
  } catch (err) {
    if (err.name === 'PreconditionFailed') {
      // A concurrent submission for the same customer+app won the write race
      // (state created/updated between our read and write). It owns case
      // creation for this slot; dropping here avoids opening a duplicate case.
      // Without a time window the only colliding submissions are effectively
      // simultaneous (sub-second), i.e. a genuine double-submit.
      log('info', 'fanout.fresh.race_lost', { customerId, appId });
      return;
    }
    throw err;
  }

  // CRM postCase — warn-not-throw, matches the bulkhead pattern used by
  // every other downstream in this Lambda (Slack, Jira). A 4xx data error
  // (e.g. CMAPI 422 "Missing Contact Information" when Profile API can't
  // supply email/phone) won't be fixed by replay, so failing the whole
  // handler → DLQ would just lose the other fanouts that are perfectly
  // capable of running. A 5xx transient failure could be retried via AWS
  // Lambda async, but that re-runs the ENTIRE handler — duplicating
  // Slack/Jira on each retry.
  // Both failure modes are better served by: log + continue, leave
  // caseId=null in state.json, let next submission within the dedup
  // window fall through to a fresh CRM attempt. Parquet is the source of
  // truth; manual replay from the parquet S3 event is the recovery path
  // for any genuinely-needed retry.
  // CRM new-case eligibility: issue/support open cases for support agents;
  // NPS feedback (rating-based survey) NEVER opens a case — even rating < 7.
  // Without this gate every NPS submission would create a case and flood the
  // support queue with non-issues.
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

  // Capture the escalated child case SF auto-creates from our standard case.
  // Needs the standard caseNumber (to match caseNumber + 1) — only attempt
  // when CRM resolution produced both the record id and the number.
  let escalated = null;
  if (caseRecordId && caseNumber) {
    escalated = await captureEscalatedCase({
      row, customerId, standardCaseNumber: caseNumber,
      context: { customerId, appId, submissionId },
    });
  }
  const escalatedCrmCaseId = escalated?.caseRecordId ?? null;

  // Persist crmCaseId + crmCaseNumber + escalatedCrmCaseId IMMEDIATELY after
  // CRM resolution, before Slack/Jira run. Tightens the dedup race window: if
  // the handler errors mid-flight (Slack 5xx, Jira 401) AWS will not retry
  // under retryAttempts=0, but a manual DLQ replay or a repeat submission will
  // see the persisted escalatedCrmCaseId and dedup-hit (note the open
  // escalated case) instead of opening a duplicate.
  const after = await readState({ bucket: stateBucket, customerId, appId });
  if (after) {
    try {
      await writeStateConditional({
        bucket: stateBucket, customerId, appId,
        state: {
          ...after.state,
          crmCaseId: caseId,
          crmCaseNumber: caseNumber,
          escalatedCrmCaseId,
          lastUpdatedAt: Date.now(),
        },
        ifMatchEtag: after.etag,
      });
    } catch (err) {
      if (err.name === 'PreconditionFailed') {
        // A concurrent submission moved the etag between our read and write,
        // so crmCaseId/escalatedCrmCaseId went unpersisted on this run. The
        // next submission would then miss the escalated case and open a
        // duplicate — log so that cause is diagnosable rather than silent.
        log('info', 'fanout.fresh.state_caseId_race_lost', { customerId, appId });
      } else {
        log('warn', 'fanout.fresh.state_caseId_failed', { error: err.message });
      }
    }
  }

  // Jira fanout runs BEFORE Slack so the Slack message can include the
  // AABSP issue key as a clickable triage link. Eligibility-gated and
  // idempotent (find-by-Feedback-ID before create — see jira-client.mjs
  // findIssueByFeedbackId, which JQL-searches the field defined by
  // FEEDBACK_ID_CUSTOM_FIELD_ID); each spam-click within the dedup window
  // is a unique submissionId so each click → unique Feedback ID →
  // distinct ticket. Wrapped warn-not-throw inside `resolveJiraKey` so a
  // Jira outage doesn't block Slack.
  const jiraKey = await resolveJiraKey({ row, submissionId, logPrefix: 'fanout.jira', s3Ref });

  // Slack delivery: builds the same Block Kit shape the UI used to build
  // (verbatim port in slack-builders.mjs / slack-format.mjs). Webhook URL
  // comes from a CDK-owned Secrets Manager secret; while unset the
  // helper silently skips. Enriched with triage links: CRM case in
  // Salesforce Lightning and the AABSP Jira issue. Each link rendered only
  // when the corresponding entity exists. Triagers can click straight from
  // Slack to the right system.
  try {
    await postSlackMessage({
      category: row.feedback_category,
      formData: buildFormDataFromRow(row),
      origin: row.feedback_origin_name ?? undefined,
      ctx: buildDiagnosticContextFromRow(row),
      // Link the ESCALATED case — that's where L2 works the ticket and where
      // our note lands. Fall back to the standard case when capture missed
      // (async escalation slower than our poll, or no confident match) so a
      // link always renders.
      enrichment: buildEnrichment({
        caseRecordId: escalated?.caseRecordId ?? caseRecordId,
        caseNumber: escalated?.caseNumber ?? caseNumber,
        jiraKey,
      }),
    });
  } catch (err) {
    log('warn', 'fanout.slack.failed', { error: err.message });
  }

  log('info', 'fanout.fresh.done', { customerId, appId, caseId, caseNumber, escalatedCrmCaseId, jiraKey });
}

/**
 * Capture the escalated child case Salesforce auto-creates from our standard
 * case. No CMAPI field links the two, so we correlate by:
 *   1. caseNumber adjacency — the escalated case's number is the standard's + 1
 *      (consistent across all observed cases; SF-confirmed). This is the
 *      primary, deterministic signal.
 *   2. Airo-Builder scope — secondaryCategory === 'Airo AI Builder', filtered
 *      client-side (CMAPI has no category query param), so a customer's
 *      escalated cases on other products can't match.
 *
 * SF creates the escalated case asynchronously, so we poll with the same
 * backoff shape as resolveCaseAsync. Returns `{ caseRecordId, caseNumber }`
 * for the matched escalated case, or null when no confident match surfaces
 * within the window (caller leaves escalatedCrmCaseId null → the next
 * submission opens a fresh case rather than noting the wrong one — fail safe).
 */
async function captureEscalatedCase({ row, customerId, standardCaseNumber, context }) {
  // CMAPI caseNumbers are zero-padded strings ("00012346"), so compare
  // numerically — the escalated child's number is the standard's + 1.
  const expectedNumber = Number(standardCaseNumber) + 1;
  const shopperId = row.shopper_id ?? null;
  for (const delay of ESCALATED_CAPTURE_DELAYS) {
    if (delay > 0) {
      const jitter = Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay + jitter));
    }
    let cases;
    try {
      cases = await findEscalatedCases({ ...crmConfig(), shopperId, customerId });
    } catch (err) {
      log('warn', 'fanout.crm.escalated.attempt_failed', { ...context, delay, error: err.message });
      continue;
    }
    const match = cases.find(
      (c) => c.secondaryCategory === AIRO_SECONDARY_CATEGORY && Number(c.caseNumber) === expectedNumber,
    );
    if (match?.caseRecordId) {
      log('info', 'fanout.crm.escalated.captured', {
        ...context, escalatedCaseId: match.caseRecordId, escalatedCaseNumber: match.caseNumber, standardCaseNumber,
      });
      return { caseRecordId: match.caseRecordId, caseNumber: match.caseNumber ?? null };
    }
  }
  log('warn', 'fanout.crm.escalated.capture_timeout', {
    ...context, standardCaseNumber, expectedNumber, attempts: ESCALATED_CAPTURE_DELAYS.length,
  });
  return null;
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
// Distinguish a permanent auth failure (401 revoked creds / 403 missing scope)
// from a transient Atlassian outage in the bulkhead logs below. jira-client
// already retries a 401 once with a fresh token, so a 401/403 that still
// surfaces here is actionable — `authError: true` lets oncall tell "page ops
// to fix the NSA credential" from "wait out an Atlassian blip".
//
// Anchored on jira-client's constructed `jira <op> <status>:` prefix rather
// than a loose digit match, so a 5xx whose response BODY happens to echo "401"
// — or a pre-fetch validation throw — is not mislabelled as an auth failure.
function isJiraAuthError(err) {
  return /^jira (?:search|create|oauth) (?:401|403)\b/.test(err?.message ?? '');
}

async function resolveJiraKey({ row, submissionId, logPrefix, s3Ref }) {
  if (!shouldCreateJiraTicket(row)) return null;

  // NSA OAuth calls go through the api.atlassian.com gateway with the cloudId
  // in the path (NOT the tenant site URL — see jira-client.mjs). Build that
  // base from JIRA_CLOUD_ID here so jira-client stays a pure REST client.
  // Explicit env-presence check matches the JIRA_PROJECT_KEY regex-rejection
  // path: a missing cloudId would otherwise produce a fetch error like
  // "fetch failed: https://api.atlassian.com/ex/jira/undefined/..." which is
  // opaque to triagers staring at CloudWatch. Surface the misconfig as a
  // distinct log line and bail to `null` so Slack/CRM continue.
  const cloudId = process.env.JIRA_CLOUD_ID;
  if (!cloudId) {
    log('warn', `${logPrefix}.config_missing`, { reason: 'JIRA_CLOUD_ID not set', feedbackId: submissionId });
    return null;
  }
  const baseUrl = `https://api.atlassian.com/ex/jira/${cloudId}`;

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
    log('warn', `${logPrefix}.find_failed`, { errorName: err.name, error: err.message, authError: isJiraAuthError(err), feedbackId: submissionId });
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
    log('warn', `${logPrefix}.create_failed`, { errorName: err.name, error: err.message, authError: isJiraAuthError(err), feedbackId: submissionId });
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
 * Eligibility for opening a NEW CRM case.
 *   - issue:    always (real customers)
 *   - support:  always (real customers)
 *   - feedback: NEVER (even rating < 7)
 *
 * Internal-user gate: GoDaddy employees have 3-char shopperIds (TLA — three
 * letter acronym). They MUST NOT open CRM cases — internal employees
 * testing the product would otherwise flood the support triage queue. PR
 * #3301 codified this contract for the now-removed legacy `/api/crm/case`
 * route. The s3-store route writes the parquet for everyone (internal users
 * included, for analytics) and does NOT pre-filter internal users, so this
 * is the defense-in-depth gate. Slack still runs for internal users; CRM is
 * the only blocked downstream here.
 *
 * Distinct from `shouldCreateJiraTicket` (jira-eligibility.mjs, which gates
 * the AABSP Jira ticket): a customer may be eligible for a Jira triage ticket
 * yet still not open a CRM case (e.g. feedback category never opens cases),
 * so the two gates are intentionally separate.
 */
function shouldOpenCrmCase(row) {
  if (typeof row.shopper_id === 'string' && row.shopper_id.length === 3) {
    return false;
  }
  const cat = row.feedback_category;
  return cat === 'issue' || cat === 'support';
}

// Maps each feedback topic (the literal `key` the UI sends, see
// app/src/components/feedback/utils.ts) to its Salesforce issue type, keyed
// by category because the bug ("issue") and support flows present DIFFERENT
// topic vocabularies. Both categories open CRM cases (shouldOpenCrmCase);
// `feedback` (NPS) does not, so it has no entry. These issue types live under
// the Websites → Airo AI Builder secondary category and all route to the same
// Airo L2 queue — `issue` is a reporting/triage label, not a routing key.
// `AI assistant` has no dedicated SF issue type yet, so it maps to General
// Support (revisit if SF adds an "AI Assistant" type).
// Note: the legacy BFF CRM path (app/src/lib/crm/case-client.ts) has been
// removed — the fanout Lambda owns all CRM case creation.
const TOPIC_TO_ISSUE = {
  support: {
    'Domain or DNS': 'Domain Change',
    'Publishing my site': 'Publishing',
    'Billing or credits': 'Credits',
    'Account or login': 'Account Login',
    'Plan or upgrade': 'Plan Change',
    'Something else': 'General Support',
  },
  issue: {
    'Editor or canvas': 'Editor',
    'AI assistant': 'General Support',
    'Publishing or preview': 'Publishing',
    'Credits or limits': 'Credits',
    'Something else': 'General Support',
  },
};

// Tie-breaker for multi-select submissions. The form is multi-select but
// `issue` is single-valued, and we lose the customer's selection order (the
// payload sorts topics alphabetically). When 2+ specific topics are picked we
// attribute to the highest-priority one. Publishing is pinned #1 per product
// priority; the rest roughly follow observed volume. Spans both vocabularies;
// ties are only ever broken within one category's producible set. General
// Support has no entry (defaults to 0) so it never beats a real specific.
// All values are intentionally distinct — reduce tie-breaking is deterministic
// only when priorities differ; equal values would silently keep the first-seen.
const ISSUE_PRIORITY = {
  'Publishing': 70,
  'Credits': 50,
  'Domain Change': 40,
  'Editor': 30,
  'Account Login': 20,
  'Plan Change': 10,
};

/**
 * Resolve the Salesforce `issue` value from the feedback category + selected
 * topics. Both `support` and `issue` (bug) carry topics and open cases;
 * `feedback` (NPS) never opens a case so it falls through to General Support.
 *
 * Rules (in order):
 *   1. No topic map for the category (e.g. feedback) → General Support.
 *   2. "Something else" anywhere in the selection → General Support (the
 *      customer signalling "doesn't fit a bucket" → human triage). Note
 *      `AI assistant` maps to General Support too but does NOT trump — a
 *      concrete co-selected topic (e.g. Editor) still wins.
 *   3. Map the remaining topics, dropping any unknown strings.
 *   4. Nothing mappable left → General Support.
 *   5. Otherwise pick the highest-priority issue (ISSUE_PRIORITY).
 *
 * Full topic list is also preserved in the case note text (`Topics: ...`),
 * so collapsing to one `issue` loses no information for the agent.
 */
function resolveIssueType(category, topics) {
  const map = TOPIC_TO_ISSUE[category];
  if (!map) return 'General Support';
  if (topics.includes('Something else')) return 'General Support';
  // Guard with typeof === 'string' instead of Boolean to defend against
  // prototype-chain lookups: map['constructor'] / map['toString'] etc. resolve
  // to Object.prototype functions (truthy) which would survive filter(Boolean)
  // and then stringify to undefined in JSON — CMAPI would receive no issue field.
  const issues = topics.map((t) => map[t]).filter((v) => typeof v === 'string');
  // Warn when topics were provided but none matched the known vocabulary —
  // converts future UI topic-key drift into a dashboard signal.
  const dropped = topics.filter((t) => t !== 'Something else' && !map[t]);
  if (dropped.length > 0 && issues.length === 0) {
    log('warn', 'fanout.crm.issue.unknown_topics', { category, droppedTopics: dropped });
  }
  if (issues.length === 0) return 'General Support';
  return issues.reduce((best, cur) =>
    (ISSUE_PRIORITY[cur] ?? 0) > (ISSUE_PRIORITY[best] ?? 0) ? cur : best,
  );
}

/**
 * Build a CMAPI case body. The field set, caseNotes structure
 * (`Comment : (appid - <id>) <details>`), and recordType/status/categories
 * are fixed by the CMAPI support-tooling contract — so support agents see
 * "Saideep Kilaru / skilaru@godaddy.com / 9170...", not a raw customerId with a
 * noreply email. Profile fields come from the parquet (BFF best-effort
 * fetched them via Profile API at submit time); when unavailable we fall
 * back to safe nulls/customerId rather than blocking the case.
 */
function buildCaseBody({ row, customerId, appId, submissionId }) {
  const text = row.feedback_text ?? '';
  const truncatedDescription = text.slice(0, 4000);
  const escalationDetails = buildEscalationDetails({ row, truncatedDescription, appId });
  const note = `Comment : ${escalationDetails}`;

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
    issue: resolveIssueType(row.feedback_category, parseTopics(row.feedback_topic_list)),
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
 * Build the escalation-details string. The `[ISSUE]` / `[SUPPORT]` /
 * `[FEEDBACK NPS <n> | consent=yes|no]` prefixes, `Topics: a, b, c`
 * capitalization, and `consent=yes` / `consent=no` markers are fixed by the
 * support-tooling contract that triages on these literals — changing them
 * requires re-training that tooling.
 */
function buildEscalationDetails({ row, truncatedDescription, appId }) {
  const cat = row.feedback_category;
  const topics = parseTopics(row.feedback_topic_list);
  const topicsLine = topics.length > 0 ? ` | Topics: ${topics.join(', ')}` : '';
  // appIdSegment appears after the routing prefix so support tooling that
  // matches on the literal [ISSUE] / [SUPPORT] prefix continues to work.
  const appIdSegment = appId ? `(appid - ${appId}) ` : '';
  if (cat === 'issue') return `[ISSUE] ${appIdSegment}${truncatedDescription}${topicsLine}`;
  if (cat === 'support') {
    return `[SUPPORT] ${appIdSegment}${truncatedDescription}${topicsLine}`;
  }
  // feedback (NPS)
  const consentMarker = row.consent_flag === true ? 'consent=yes' : 'consent=no';
  const ratingLabel = row.rating ?? 'unknown';
  return `[FEEDBACK NPS ${ratingLabel} | ${consentMarker}] ${truncatedDescription}${topicsLine}`;
}

function renderDuplicateNote({ submissionId, appId, row }) {
  const appIdSegment = appId ? `(appid - ${appId}) ` : '';
  return [
    `Follow-up submission on an open escalated case. ${appIdSegment}`.trimEnd(),
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

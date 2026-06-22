import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// `mock.module` cannot remock the same specifier in a single process, and
// dynamic `await import(...)` is cached after the first call. We therefore
// install one mock per specifier at top-level with mutable closure impls,
// then reassign the closures (and reset `calls`) inside `beforeEach` to
// shape per-test behavior.
let s3SendImpl = async () => ({});
let parseFeedbackParquetImpl = async () => ({});
let readStateImpl = async () => null;
let writeStateConditionalImpl = async () => {};
let postCaseImpl = async () => ({});
let getCaseImpl = async () => null;
let getCaseByExternalIdImpl = async () => null;
let postNoteImpl = async () => {};
let resolveCaseAsyncImpl = async () => null;
let findEscalatedCasesImpl = async () => [];
let postSlackMessageImpl = async () => {};
let findIssueByFeedbackIdImpl = async () => null;
let createIssueImpl = async () => ({ key: 'AABSP-1', id: '10000' });

// `calls` is a stable object — beforeEach mutates `.length = 0` on each
// array rather than reassigning `calls`, so the closures captured by the
// `mock.module` named exports continue to write to the same arrays.
//
// Note: the investigator was removed from the fanout Lambda (hard-off), so
// there is no `invoke` mock or counter here anymore.
const calls = {
  postCase: [],
  getCase: [],
  getCaseByExternalId: [],
  postNote: [],
  resolveCase: [],
  findEscalated: [],
  stateRead: [],
  stateWrite: [],
  slack: [],
  jiraFind: [],
  jiraCreate: [],
};

// Switchboard-stamped config that re-enables Jira tickets for ALL categories.
// Default (no stamp) is issue/support OFF, feedback ON (rating < 7), so tests
// exercising the issue/support Jira-create mechanics opt in via this value.
const ENABLE_ALL_JIRA = JSON.stringify({
  issue: true,
  support: true,
  feedback: { enabled: true, maxRating: 7 },
});

mock.module('@aws-sdk/client-s3', {
  namedExports: {
    S3Client: class {
      send(command) {
        return s3SendImpl(command);
      }
    },
    GetObjectCommand: class {
      constructor(input) {
        this.input = input;
      }
    },
  },
});

mock.module('./parquet-reader.mjs', {
  namedExports: {
    parseFeedbackParquet: (...args) => parseFeedbackParquetImpl(...args),
  },
});

mock.module('./state.mjs', {
  namedExports: {
    keyFor: (c, a) => `dedup/${c}/${a}/state.json`,
    readState: async (...args) => {
      calls.stateRead.push(args[0]);
      return readStateImpl(...args);
    },
    writeStateConditional: async (...args) => {
      calls.stateWrite.push(args[0]);
      return writeStateConditionalImpl(...args);
    },
  },
});

mock.module('./crm-client.mjs', {
  namedExports: {
    postCase: async (...args) => {
      calls.postCase.push(args[0]);
      return postCaseImpl(...args);
    },
    getCase: async (...args) => {
      calls.getCase.push(args[0]);
      return getCaseImpl(...args);
    },
    getCaseByExternalId: async (...args) => {
      calls.getCaseByExternalId.push(args[0]);
      return getCaseByExternalIdImpl(...args);
    },
    postNote: async (...args) => {
      calls.postNote.push(args[0]);
      return postNoteImpl(...args);
    },
    resolveCaseAsync: async (...args) => {
      calls.resolveCase.push(args[0]);
      return resolveCaseAsyncImpl(...args);
    },
    findEscalatedCases: async (...args) => {
      calls.findEscalated.push(args[0]);
      return findEscalatedCasesImpl(...args);
    },
  },
});

mock.module('./slack.mjs', {
  namedExports: {
    postSlackMessage: async (...args) => {
      calls.slack.push(args[0]);
      return postSlackMessageImpl(...args);
    },
  },
});

mock.module('./jira-client.mjs', {
  namedExports: {
    findIssueByFeedbackId: async (...args) => {
      calls.jiraFind.push(args[0]);
      return findIssueByFeedbackIdImpl(...args);
    },
    createIssue: async (...args) => {
      calls.jiraCreate.push(args[0]);
      return createIssueImpl(...args);
    },
  },
});

// jira-mapping.mjs and jira-eligibility.mjs are pure functions with their own
// dedicated test files. We don't mock them here — the handler test exercises
// the real builder + eligibility gate so regressions in label/summary shape or
// eligibility semantics would show up in the createIssue payload assertions.

const { handler } = await import('./handler.mjs');

const FEEDBACK_ROW = {
  customer_id: 'cust-1',
  app_id: 'app-1',
  feedback_id: 'sub-1',
  feedback_origin_name: 'first-publish-banner',
  feedback_category: 'issue',
  rating: 2,
  feedback_text: 'broken thing',
  feedback_topic_list: '["topic-a"]',
  consent_flag: true,
  // Contact fields — restored in PR #4241 after CMAPI rejected null contactEmail.
  // CMAPI requires contactPhone OR contactEmail; these come from the BFF's
  // fetchCustomerProfile at submit time and are read by buildCaseBody.
  customer_first_name: 'Jane',
  customer_last_name: 'Doe',
  customer_email: 'jane.doe@example.com',
  customer_phone: '5551234567',
  shopper_id: 'shopper-123',
  // Per-submission Switchboard gate stamped by the BFF. Default fixture
  // is ON so the bulk of fanout tests exercise the full flow; the
  // dedicated `fanout_via_lambda !== true` tests below override this.
  fanout_via_lambda: true,
  // No `jira_eligibility_config` → Lambda applies its default: issue/support
  // OFF, feedback ON (rating < 7). Tests needing issue/support Jira tickets
  // stamp ENABLE_ALL_JIRA explicitly.
};

const S3_EVENT = {
  Records: [
    {
      s3: {
        bucket: { name: 'airo-builder-feedback-test' },
        object: { key: 'feedback/cust-1/app-1/sub-1.parquet' },
      },
    },
  ],
};

beforeEach(() => {
  for (const k of Object.keys(calls)) {
    calls[k].length = 0;
  }

  // Default impls
  s3SendImpl = async () => ({
    Body: {
      transformToByteArray: async () => new Uint8Array([1, 2, 3]),
    },
  });
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW });
  readStateImpl = async () => null;
  writeStateConditionalImpl = async () => {};
  postCaseImpl = async () => ({
    caseId: '500U900000TP4kYIAT',
    caseNumber: '00012345',
    referenceId: null,
    created: true,
  });
  // Default: return a case with caseNumber so sync-path caseNumber fetch works.
  // isClosed:false marks it open (dedup gates on isClosed, not status).
  // Dedup tests that need a closed/missing case override this per-test.
  getCaseImpl = async () => ({ caseRecordId: '500U900000TP4kYIAT', caseNumber: '00012345', status: 'Open', isClosed: false });
  // Default: pre-POST guard sees no existing case → handler proceeds to postCase.
  // Tests covering the guard-hit scenario override this per-test.
  getCaseByExternalIdImpl = async () => null;
  postNoteImpl = async () => {};
  resolveCaseAsyncImpl = async () => null;
  // Default: escalated capture finds the matching child (standard 00012345 →
  // escalated 00012346) under Airo AI Builder. Tests override per-scenario.
  findEscalatedCasesImpl = async () => [
    { caseRecordId: '500ESCALATED000001', caseNumber: '00012346', secondaryCategory: 'Airo AI Builder', isClosed: false },
  ];
  postSlackMessageImpl = async () => {};
  findIssueByFeedbackIdImpl = async () => null;
  createIssueImpl = async () => ({ key: 'AABSP-1', id: '10000' });

  process.env.JIRA_OAUTH_SECRET_ARN = 'arn:aws:secretsmanager:us-west-2:111:secret:airo-fanout-jira-oauth';
  process.env.JIRA_BASE_URL = 'https://godaddy-corp.atlassian.net';
  process.env.JIRA_CLOUD_ID = '1f012970-03f4-4025-b750-cbaa332d8a3b';
  process.env.JIRA_PROJECT_KEY = 'AABSP';

  process.env.FEEDBACK_BUCKET = 'airo-builder-feedback-test';
  process.env.CRM_BASE_URL = 'https://crm.example.com';
  process.env.CRM_CERT_SECRET_ARN = '/Katana/Secrets/airobuilde/app/pre-test/AIRO_CLIENT_CERT';
  process.env.CRM_KEY_SECRET_ARN = '/Katana/Secrets/airobuilde/app/pre-test/AIRO_CLIENT_KEY';
  process.env.AIRO_SSO_ENDPOINT = 'https://sso.example.com/v1/secure/api/token';
  process.env.SLACK_WEBHOOK_SECRET_ARN = 'arn:aws:secretsmanager:us-west-2:111:secret:airo-fanout-slack-webhook';
  process.env.SALESFORCE_LIGHTNING_BASE = 'https://godaddy2.lightning.force.com';
});

await test('fresh path (issue): opens case, writes state, posts Slack; NO kickoff note, NO Jira by default', async () => {
  // First readState (upfront dedup check) returns null; second readState
  // (post-postCase re-read for etag) returns the freshly-written lock so
  // the handler can perform the IfMatch crmCaseId update.
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: {
        schemaVersion: 1,
        submissionId: 'sub-1',
        crmCaseId: null,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
      },
      etag: '"e-fresh"',
    };
  };

  await handler(S3_EVENT);

  // Implementation does TWO state reads on fresh path: upfront dedup check + post-postCase
  // re-read for etag before writing crmCaseId.
  assert.equal(calls.stateRead.length, 2);
  assert.equal(calls.stateWrite.length, 2);
  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
  // Kickoff note removed with the investigator — no CRM note posted on fresh path.
  assert.equal(calls.postNote.length, 0);
  // issue category Jira is OFF by default → no find/create.
  assert.equal(calls.jiraFind.length, 0);
  assert.equal(calls.jiraCreate.length, 0);
  assert.equal(calls.postCase[0].body.externalSystemId, 'airo-cust-1-app-1-sub-1');
  // Contact fields — CMAPI requires contactPhone OR contactEmail (422 if both null).
  // Pin these so a regression (re-nulling) breaks CI before reaching prod.
  assert.equal(calls.postCase[0].body.contactEmail, 'jane.doe@example.com');
  assert.equal(calls.postCase[0].body.contactFirstName, 'Jane');
  assert.equal(calls.postCase[0].body.contactLastName, 'Doe');
  assert.equal(calls.postCase[0].body.contactPhone, '5551234567');
  assert.equal(calls.postCase[0].body.contactName, 'Jane Doe');
  // Slack call routed through buildFormDataFromRow + the issue branch of
  // postSlackMessage — pin the category so a regression that defaults to
  // 'feedback' (which expects rating + comment) is caught here.
  assert.equal(calls.slack[0].category, 'issue');
  assert.deepEqual(calls.slack[0].formData, {
    topics: ['topic-a'],
    description: 'broken thing',
    followUp: true,
  });
  // Triage-link enrichment: links the ESCALATED case (captured: standard
  // 00012345 → escalated 00012346) since that's where L2 works it. Jira link
  // absent because issue Jira is OFF by default.
  assert.ok(calls.slack[0].enrichment);
  assert.match(calls.slack[0].enrichment.crmCaseUrl, /\/lightning\/r\/Case\/500ESCALATED000001\/view$/);
  assert.equal(calls.slack[0].enrichment.caseNumber, '00012346');
  assert.equal(calls.slack[0].enrichment.jiraKey, undefined);
  assert.equal(calls.slack[0].enrichment.jiraUrl, undefined);
  // Sync path: no resolver poll, but one getCase call to fetch caseNumber
  // (POST response never includes caseNumber on either sync or async path).
  assert.equal(calls.resolveCase.length, 0);
  assert.equal(calls.getCase.length, 1);
  assert.equal(calls.getCase[0].caseId, '500U900000TP4kYIAT');
});

await test('fresh path: maps support/issue topics to the Salesforce issue field', async () => {
  // Fresh-path readState: null upfront, then a written lock for the etag re-read.
  const freshReadState = () => {
    let readCount = 0;
    return async () => {
      readCount += 1;
      if (readCount === 1) return null;
      return {
        state: { schemaVersion: 1, submissionId: 'sub-1', crmCaseId: null, startedAt: Date.now(), lastUpdatedAt: Date.now() },
        etag: '"e-fresh"',
      };
    };
  };

  // [category, topics JSON, expected issue]. Exercises the real path:
  // parquet row → parseTopics → resolveIssueType → buildCaseBody → postCase.
  const cases = [
    ['support', '["Domain or DNS"]', 'Domain Change'],
    ['support', '["Billing or credits"]', 'Credits'],
    ['support', '["Publishing my site","Billing or credits"]', 'Publishing'], // Publishing(70) pinned #1
    ['support', '["Domain or DNS","Billing or credits"]', 'Credits'],        // Credits(50) > Domain(40)
    ['support', '["Domain or DNS","Something else"]', 'General Support'],     // trump
    ['support', '["nonsense"]', 'General Support'],                           // unknown → fallback
    ['support', '["nonsense","Domain or DNS"]', 'Domain Change'],            // unknown + known → known wins
    ['support', '["constructor"]', 'General Support'],                       // prototype key → never a function
    ['support', '["toString","Domain or DNS"]', 'Domain Change'],            // prototype key + known → known wins
    ['support', null, 'General Support'],                                     // no topics
    ['issue', '["Editor or canvas"]', 'Editor'],
    ['issue', '["Credits or limits"]', 'Credits'],
    ['issue', '["Editor or canvas","Publishing or preview"]', 'Publishing'], // Publishing(70) > Editor(30)
    ['issue', '["Credits or limits","Editor or canvas"]', 'Credits'],        // Credits(50) > Editor(30)
    ['issue', '["AI assistant"]', 'General Support'],                         // no SF type
    ['issue', '["AI assistant","Editor or canvas"]', 'Editor'],              // AI doesn't trump
    ['issue', '["Editor or canvas","Something else"]', 'General Support'],    // trump
  ];

  for (const [category, topicList, expected] of cases) {
    for (const k of Object.keys(calls)) calls[k].length = 0;
    readStateImpl = freshReadState();
    parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, feedback_category: category, feedback_topic_list: topicList });

    await handler(S3_EVENT);

    assert.equal(calls.postCase.length, 1, `${category} ${topicList}: one case`);
    assert.equal(
      calls.postCase[0].body.issue,
      expected,
      `${category} ${topicList} → expected issue "${expected}"`,
    );
  }
});

await test('fresh path (issue): topics appended to [ISSUE] escalationDetails and case note', async () => {
  // Locks the behavior change: bug-report notes now include "| Topics: ..." just
  // like support notes — was previously dropped on the issue branch.
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: { schemaVersion: 1, submissionId: 'sub-1', crmCaseId: null, startedAt: Date.now(), lastUpdatedAt: Date.now() },
      etag: '"e-fresh"',
    };
  };
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'issue',
    feedback_topic_list: '["Editor or canvas","Publishing or preview"]',
  });

  await handler(S3_EVENT);

  const body = calls.postCase[0].body;
  const expectedTopics = ' | Topics: Editor or canvas, Publishing or preview';
  assert.ok(
    body.additionalData.escalationDetails.startsWith('[ISSUE] '),
    'escalationDetails must be prefixed [ISSUE]',
  );
  assert.ok(
    body.additionalData.escalationDetails.endsWith(expectedTopics),
    `escalationDetails must end with topics line, got: ${body.additionalData.escalationDetails}`,
  );
  assert.ok(
    body.caseNotes[0].note.includes(expectedTopics),
    'case note must include topics line',
  );
});

await test('fresh path: async-mode postCase → resolver polls and materializes Salesforce caseRecordId + caseNumber', async () => {
  // CMAPI async POST returns only `referenceId` (= our externalSystemId
  // echoed back) — caseId/caseNumber are null until SF Adapter persists
  // the case in Salesforce. Resolver polls GET ?externalId= with backoff;
  // hit on the first attempt here, so the Slack enrichment carries the
  // real SF Record ID for the Lightning URL and the customer-facing
  // caseNumber for the link label.
  postCaseImpl = async () => ({
    caseId: null,
    caseNumber: null,
    referenceId: 'airo-cust-1-app-1-sub-1',
    created: null,
  });
  resolveCaseAsyncImpl = async () => ({
    caseRecordId: '500U900000TP4kYIAT',
    caseNumber: '00067890',
  });
  // Escalated child of the async-resolved standard 00067890 → 00067891.
  findEscalatedCasesImpl = async () => [
    { caseRecordId: '500ESCALATED067891', caseNumber: '00067891', secondaryCategory: 'Airo AI Builder', isClosed: false },
  ];
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: { schemaVersion: 2, submissionId: 'sub-1', crmCaseId: null, crmCaseNumber: null, escalatedCrmCaseId: null, lastUpdatedAt: Date.now() },
      etag: '"e-fresh"',
    };
  };

  await handler(S3_EVENT);

  assert.equal(calls.resolveCase.length, 1);
  assert.equal(calls.resolveCase[0].externalId, 'airo-cust-1-app-1-sub-1');
  // Async path resolves the standard SF Record ID, then captures its escalated
  // child — Slack links the ESCALATED case (where L2 works it).
  assert.ok(calls.slack[0].enrichment);
  assert.match(calls.slack[0].enrichment.crmCaseUrl, /\/lightning\/r\/Case\/500ESCALATED067891\/view$/);
  assert.equal(calls.slack[0].enrichment.caseNumber, '00067891');
});

await test('fresh path: async-mode resolver miss → Slack still posts with no Case link, no crash', async () => {
  // Resolver polls all attempts and returns null (SF persistence took longer
  // than the budget). With issue Jira OFF by default and no CRM link, the
  // enrichment collapses to null — buildEnrichment returns null and the rest
  // of the Slack message remains intact (no thrown error).
  postCaseImpl = async () => ({
    caseId: null,
    caseNumber: null,
    referenceId: 'airo-cust-1-app-1-sub-1',
    created: null,
  });
  resolveCaseAsyncImpl = async () => null;
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: {
        schemaVersion: 1,
        submissionId: 'sub-1',
        crmCaseId: null,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
      },
      etag: '"e-fresh"',
    };
  };

  await handler(S3_EVENT);

  assert.equal(calls.resolveCase.length, 1);
  // Slack still fired even with resolver miss
  assert.equal(calls.slack.length, 1);
  // No CRM link (resolver miss) and no Jira link (issue default OFF).
  assert.equal(calls.slack[0].enrichment?.crmCaseUrl, undefined);
  assert.equal(calls.slack[0].enrichment?.caseNumber, undefined);
  assert.equal(calls.slack[0].enrichment?.jiraKey, undefined);
});

await test('fresh path: sync-mode getCase failure leaves caseNumber null but Slack still posts with link', async () => {
  // Sync-path postCase returns SF Record ID directly, then we fire a
  // single getCase to fetch caseNumber. If that GET throws (transient
  // CMAPI hiccup), bulkhead pattern: log warn, continue, render Slack
  // with the SF link but no `Case #...` label (Slack falls back to
  // plain `Case`). The Lambda must not crash and CRM-case opening
  // must still be reported as success because the case IS in CRM.
  postCaseImpl = async () => ({
    caseId: '500U900000TP4kYIAT',
    caseNumber: null,
    referenceId: null,
    created: true,
  });
  getCaseImpl = async () => { throw new Error('CMAPI 503 transient'); };
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: {
        schemaVersion: 1,
        submissionId: 'sub-1',
        crmCaseId: null,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
      },
      etag: '"e-fresh"',
    };
  };

  await handler(S3_EVENT);

  assert.equal(calls.getCase.length, 1, 'sync path attempted to fetch caseNumber');
  assert.equal(calls.slack.length, 1, 'Slack post not blocked by getCase failure');
  // Salesforce link rendered (caseRecordId came from postCase), but no
  // caseNumber → buildTriageLinks renders plain `Case` not `Case #...`.
  assert.match(calls.slack[0].enrichment.crmCaseUrl, /\/lightning\/r\/Case\/500U900000TP4kYIAT\/view$/);
  assert.equal(calls.slack[0].enrichment.caseNumber, undefined);
});

await test('fresh path: support category routes Slack with category=support and same form-data shape', async () => {
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: {
        schemaVersion: 1,
        submissionId: 'sub-1',
        crmCaseId: null,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
      },
      etag: '"e-fresh"',
    };
  };
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'support',
    feedback_text: 'help with my domain',
    feedback_topic_list: '["Domain or DNS"]',
  });

  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
  assert.equal(calls.slack[0].category, 'support');
  assert.deepEqual(calls.slack[0].formData, {
    topics: ['Domain or DNS'],
    description: 'help with my domain',
    followUp: true,
  });
  // support Jira is OFF by default.
  assert.equal(calls.jiraCreate.length, 0);
});

await test('exits cleanly when row.fanout_via_lambda === false (BFF/UI owns delivery)', async () => {
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, fanout_via_lambda: false });
  await handler(S3_EVENT);
  assert.equal(calls.stateRead.length, 0);
  assert.equal(calls.postCase.length, 0);
  assert.equal(calls.slack.length, 0);
});

await test('exits cleanly when row.fanout_via_lambda is null/missing (legacy or failed flag lookup)', async () => {
  parseFeedbackParquetImpl = async () => {
    const { fanout_via_lambda: _omit, ...rest } = FEEDBACK_ROW;
    return rest;
  };
  await handler(S3_EVENT);
  assert.equal(calls.stateRead.length, 0);
  assert.equal(calls.postCase.length, 0);
  assert.equal(calls.slack.length, 0);
});

await test('runs full flow when row.fanout_via_lambda === true', async () => {
  // Sanity duplicate of the fresh-path coverage but explicit on the gate
  // value — guards against a future change that ignores the gate.
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: {
        schemaVersion: 1,
        submissionId: 'sub-1',
        crmCaseId: null,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
      },
      etag: '"e-fresh"',
    };
  };
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, fanout_via_lambda: true });

  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
});

// Dedup state with a captured escalated case. The escalated case is the
// dedup TARGET (notes go there); the standard case is what Slack links.
const DEDUP_STATE = {
  schemaVersion: 2,
  submissionId: 'old',
  crmCaseId: '500U900000TP4kYIAT',
  crmCaseNumber: '00012345',
  escalatedCrmCaseId: '500ESCALATED000001',
  lastUpdatedAt: Date.now(),
};

await test('dedup hit (escalated open): notes the ESCALATED case, links standard in Slack, no new CRM case', async () => {
  readStateImpl = async () => ({ state: { ...DEDUP_STATE }, etag: '"e1"' });
  // getCase(escalatedCaseId) → open. Escalated cases carry a workflow status
  // (never literally "Open"), so isClosed:false is what marks it open.
  getCaseImpl = async () => ({ caseRecordId: '500ESCALATED000001', caseNumber: '00012346', status: 'Waiting for Risk', isClosed: false });
  findIssueByFeedbackIdImpl = async () => null;
  // Enable issue-category Jira so the dedup-path Jira create is exercised.
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, jira_eligibility_config: ENABLE_ALL_JIRA });

  await handler(S3_EVENT);

  assert.equal(calls.getCase.length, 1, 'one getCase — the escalated status check');
  assert.equal(calls.getCase[0].caseId, '500ESCALATED000001', 'status check targets the escalated case');
  assert.equal(calls.postNote.length, 1, 'one note posted');
  assert.equal(calls.postNote[0].caseRecordId, '500ESCALATED000001', 'note posted to the ESCALATED case');
  assert.equal(calls.postCase.length, 0, 'no new CRM case opened on dedup hit');
  assert.equal(calls.slack.length, 1, 'Slack still pings on dedup hit');
  assert.equal(calls.jiraCreate.length, 1, 'Jira ticket still created on dedup hit (eligibility-gated)');
  // Slack links the ESCALATED case we just noted (from the live status fetch),
  // labelled with its number — that's where L2 works it.
  assert.ok(calls.slack[0].enrichment, 'dedup Slack call has enrichment');
  assert.match(calls.slack[0].enrichment.crmCaseUrl, /\/lightning\/r\/Case\/500ESCALATED000001\/view$/);
  assert.equal(calls.slack[0].enrichment.caseNumber, '00012346');
  assert.equal(calls.slack[0].enrichment.jiraKey, 'AABSP-1');
  assert.match(calls.slack[0].enrichment.jiraUrl, /\/browse\/AABSP-1$/);
  const dedupS3Ref = calls.jiraCreate[0].body.fields.customfield_36259;
  assert.ok(typeof dedupS3Ref === 'string' && dedupS3Ref.startsWith('s3://'));
});

await test('dedup hit: Jira eligibility comes from the NEW row config, not existing state (issue + no config → no Jira)', async () => {
  // Pins "new-row's jira_eligibility_config decides eligibility" so a future
  // refactor can't quietly read config off existing.state. NEW row is issue
  // category with NO config → default OFF → no Jira call. Note + Slack still fire.
  readStateImpl = async () => ({ state: { ...DEDUP_STATE }, etag: '"e1"' });
  getCaseImpl = async () => ({ caseRecordId: '500ESCALATED000001', isClosed: false });
  // Default FEEDBACK_ROW: issue category, no jira_eligibility_config.

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 0, 'no Jira find — issue default OFF on dedup path');
  assert.equal(calls.jiraCreate.length, 0, 'no Jira create — eligibility from new row, not existing state');
  assert.equal(calls.postNote.length, 1, 'note still posted to escalated case');
  assert.equal(calls.postNote[0].caseRecordId, '500ESCALATED000001');
  assert.equal(calls.slack.length, 1, 'Slack still pings');
  assert.equal(calls.postCase.length, 0, 'no new CRM case on dedup hit');
});

await test('dedup miss (escalated case CLOSED): falls through to fresh path, opens new case', async () => {
  readStateImpl = async () => ({ state: { ...DEDUP_STATE }, etag: '"e1"' });
  getCaseImpl = async () => ({ caseRecordId: '500ESCALATED000001', status: 'Closed', isClosed: true });

  await handler(S3_EVENT);

  assert.equal(calls.postNote.length, 0, 'no dedup note when the escalated case is closed');
  assert.equal(calls.postCase.length, 1, 'a new standard case is opened');
  assert.equal(calls.slack.length, 1);
});

await test('dedup miss (legacy v1 state, no escalatedCrmCaseId): falls through to fresh path', async () => {
  // Migration: in-flight v1 states lack escalatedCrmCaseId. Next submission
  // opens a fresh case (and captures its escalated child as v2) rather than
  // noting a case it can't address.
  readStateImpl = async () => ({
    state: { schemaVersion: 1, submissionId: 'old', crmCaseId: '500U900000TP4kYIAT', startedAt: Date.now(), lastUpdatedAt: Date.now() },
    etag: '"e1"',
  });

  await handler(S3_EVENT);

  assert.equal(calls.postNote.length, 0, 'no dedup note — no escalated case captured in legacy state');
  assert.equal(calls.postCase.length, 1, 'opens a fresh case');
});

await test('no time window: old state with an OPEN escalated case still dedups (no age expiry)', async () => {
  // The 1-hour window is gone — only open/closed status gates dedup. A 90-min-old
  // state whose escalated case is still open must still dedup, never open a new case.
  readStateImpl = async () => ({
    state: { ...DEDUP_STATE, lastUpdatedAt: Date.now() - 90 * 60 * 1000 },
    etag: '"e1"',
  });
  getCaseImpl = async () => ({ caseRecordId: '500ESCALATED000001', isClosed: false });

  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 0, 'no new case — escalated still open 90 min later');
  assert.equal(calls.postNote.length, 1, 'notes the open escalated case');
  assert.equal(calls.postNote[0].caseRecordId, '500ESCALATED000001');
});

await test('fresh path: captures escalated case (caseNumber+1, Airo Builder) into state', async () => {
  // Standard case 00012345 → escalated child 00012346 under Airo AI Builder.
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: { schemaVersion: 2, submissionId: 'sub-1', crmCaseId: null, crmCaseNumber: null, escalatedCrmCaseId: null, lastUpdatedAt: Date.now() },
      etag: '"e-fresh"',
    };
  };

  await handler(S3_EVENT);

  assert.equal(calls.findEscalated.length, 1, 'queried escalated cases once (matched first attempt)');
  // The post-CRM state write must persist standard id+number AND the escalated id.
  const lastWrite = calls.stateWrite[calls.stateWrite.length - 1];
  assert.equal(lastWrite.state.crmCaseId, '500U900000TP4kYIAT');
  assert.equal(lastWrite.state.crmCaseNumber, '00012345');
  assert.equal(lastWrite.state.escalatedCrmCaseId, '500ESCALATED000001');
});

await test('fresh path: escalated capture miss (no caseNumber+1 match) leaves escalatedCrmCaseId null', async () => {
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: { schemaVersion: 2, submissionId: 'sub-1', crmCaseId: null, crmCaseNumber: null, escalatedCrmCaseId: null, lastUpdatedAt: Date.now() },
      etag: '"e-fresh"',
    };
  };
  // No case with caseNumber 00012346 → capture finds nothing across all polls.
  findEscalatedCasesImpl = async () => [
    { caseRecordId: '500OTHER', caseNumber: '00099999', secondaryCategory: 'Airo AI Builder', isClosed: false },
  ];

  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 1, 'case still opened');
  const lastWrite = calls.stateWrite[calls.stateWrite.length - 1];
  assert.equal(lastWrite.state.escalatedCrmCaseId, null, 'no confident match → escalatedCrmCaseId stays null');
  // Capture missed across all polls → Slack falls back to the STANDARD case.
  assert.match(calls.slack[0].enrichment.crmCaseUrl, /\/lightning\/r\/Case\/500U900000TP4kYIAT\/view$/);
  assert.equal(calls.slack[0].enrichment.caseNumber, '00012345');
});

await test('fresh path: escalated capture ignores non-Airo-Builder cases even at caseNumber+1', async () => {
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: { schemaVersion: 2, submissionId: 'sub-1', crmCaseId: null, crmCaseNumber: null, escalatedCrmCaseId: null, lastUpdatedAt: Date.now() },
      etag: '"e-fresh"',
    };
  };
  // caseNumber matches (+1) but it's a different product → must NOT be captured.
  findEscalatedCasesImpl = async () => [
    { caseRecordId: '500DOMAINS', caseNumber: '00012346', secondaryCategory: 'Domains', isClosed: false },
  ];

  await handler(S3_EVENT);

  const lastWrite = calls.stateWrite[calls.stateWrite.length - 1];
  assert.equal(lastWrite.state.escalatedCrmCaseId, null, 'non-Airo escalated case not captured');
});

await test('fresh path: escalated capture retries — empty first poll, match on a later poll', async () => {
  // Exercises the backoff loop: SF has not created the escalated child yet on
  // the first poll, then it appears. Without the retry the capture would miss.
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: { schemaVersion: 2, submissionId: 'sub-1', crmCaseId: null, crmCaseNumber: null, escalatedCrmCaseId: null, lastUpdatedAt: Date.now() },
      etag: '"e-fresh"',
    };
  };
  let poll = 0;
  findEscalatedCasesImpl = async () => {
    poll += 1;
    if (poll === 1) return []; // not created yet
    return [{ caseRecordId: '500ESCALATED000001', caseNumber: '00012346', secondaryCategory: 'Airo AI Builder', isClosed: false }];
  };

  await handler(S3_EVENT);

  assert.ok(calls.findEscalated.length >= 2, 'polled again after the empty first attempt');
  const lastWrite = calls.stateWrite[calls.stateWrite.length - 1];
  assert.equal(lastWrite.state.escalatedCrmCaseId, '500ESCALATED000001', 'captured on the retry');
});

await test('fresh path: escalated capture survives a throwing poll (attempt_failed → continue → match)', async () => {
  let readCount = 0;
  readStateImpl = async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: { schemaVersion: 2, submissionId: 'sub-1', crmCaseId: null, crmCaseNumber: null, escalatedCrmCaseId: null, lastUpdatedAt: Date.now() },
      etag: '"e-fresh"',
    };
  };
  let poll = 0;
  findEscalatedCasesImpl = async () => {
    poll += 1;
    if (poll === 1) throw new Error('CMAPI GET escalated 503'); // transient
    return [{ caseRecordId: '500ESCALATED000001', caseNumber: '00012346', secondaryCategory: 'Airo AI Builder', isClosed: false }];
  };

  await handler(S3_EVENT);

  assert.ok(calls.findEscalated.length >= 2, 'kept polling after the throwing attempt');
  const lastWrite = calls.stateWrite[calls.stateWrite.length - 1];
  assert.equal(lastWrite.state.escalatedCrmCaseId, '500ESCALATED000001', 'captured after the transient failure');
});

await test('race on create: writeStateConditional 412 → drops (no duplicate case opened)', async () => {
  // A concurrent submission for the same customer+app won the create race.
  // The losing run must drop (no postCase) rather than open a duplicate.
  readStateImpl = async () => null; // fresh: no prior state
  writeStateConditionalImpl = async () => {
    const err = new Error('At least one of the pre-conditions you specified did not hold');
    err.name = 'PreconditionFailed';
    throw err;
  };

  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 0, 'no CRM case opened — race lost, dropped');
  assert.equal(calls.slack.length, 0, 'no Slack — dropped before fanout');
});

await test('dedup hit: note POST failure is surfaced (noteOk=false) but Slack/Jira still run', async () => {
  readStateImpl = async () => ({ state: { ...DEDUP_STATE }, etag: '"e1"' });
  getCaseImpl = async () => ({ caseRecordId: '500ESCALATED000001', caseNumber: '00012346', isClosed: false });
  postNoteImpl = async () => { throw new Error('CMAPI note 503'); };

  await handler(S3_EVENT);

  assert.equal(calls.postNote.length, 1, 'note attempted');
  assert.equal(calls.postCase.length, 0, 'still a dedup hit — no new case despite note failure');
  assert.equal(calls.slack.length, 1, 'Slack still pings even when the note dropped');
});

// ---- Jira fanout tests ----

// Helper: fresh-path readState pattern reused across Jira tests below.
function freshReadStateImpl() {
  let readCount = 0;
  return async () => {
    readCount += 1;
    if (readCount === 1) return null;
    return {
      state: {
        schemaVersion: 2,
        submissionId: 'sub-1',
        crmCaseId: null,
        crmCaseNumber: null,
        escalatedCrmCaseId: null,
        lastUpdatedAt: Date.now(),
      },
      etag: '"e-fresh"',
    };
  };
}

await test('jira: issue category with config enabled → findIssueByFeedbackId then createIssue (Bug)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, jira_eligibility_config: ENABLE_ALL_JIRA });

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 1);
  // API calls go through the NSA OAuth gateway (cloudId in path), not the tenant URL.
  assert.equal(calls.jiraFind[0].baseUrl, 'https://api.atlassian.com/ex/jira/1f012970-03f4-4025-b750-cbaa332d8a3b');
  assert.equal(calls.jiraFind[0].projectKey, 'AABSP');
  assert.equal(calls.jiraFind[0].feedbackId, 'sub-1');
  assert.equal(calls.jiraCreate.length, 1);
  assert.equal(calls.jiraCreate[0].baseUrl, 'https://api.atlassian.com/ex/jira/1f012970-03f4-4025-b750-cbaa332d8a3b');
  assert.equal(calls.jiraCreate[0].body.fields.issuetype.name, 'Bug');
  assert.equal(calls.jiraCreate[0].body.fields.project.key, 'AABSP');
});

await test('jira: issue category WITHOUT config → no Jira ticket (default OFF)', async () => {
  readStateImpl = freshReadStateImpl();
  // Default FEEDBACK_ROW: issue category, no jira_eligibility_config.

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 0, 'issue Jira find skipped by default');
  assert.equal(calls.jiraCreate.length, 0, 'issue Jira create skipped by default');
  // CRM + Slack still run for issue category.
  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
});

await test('jira: support category with config enabled → createIssue called (SOS Support)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'support',
    feedback_text: 'help with my domain',
    jira_eligibility_config: ENABLE_ALL_JIRA,
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 1);
  assert.equal(calls.jiraCreate.length, 1);
  assert.equal(calls.jiraCreate[0].body.fields.issuetype.name, 'SOS Support');
});

await test('jira: support category WITHOUT config → no Jira ticket (default OFF)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'support',
    feedback_text: 'help with my domain',
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 0);
  assert.equal(calls.jiraCreate.length, 0);
});

await test('jira: feedback rating=3 → Prod Feedback ticket with Feedback ID + Rating custom field (default ON)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'feedback',
    rating: 3,
    feedback_text: 'meh',
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraCreate.length, 1);
  const body = calls.jiraCreate[0].body;
  assert.equal(body.fields.issuetype.name, 'Prod Feedback');
  assert.deepEqual(body.fields.labels, ['AAB-App']);
  assert.equal(body.fields.customfield_36238, 'sub-1'); // Feedback ID drives dedup now
  assert.deepEqual(body.fields.customfield_36239, { value: '3/7' });
});

await test('jira: createIssue body carries S3 Object Reference custom field built from event bucket+key', async () => {
  readStateImpl = freshReadStateImpl();
  // feedback rating 2 → Jira ON by default; exercises s3Ref threading.
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, feedback_category: 'feedback', rating: 2 });

  await handler(S3_EVENT);

  assert.equal(calls.jiraCreate.length, 1);
  const s3Ref = calls.jiraCreate[0].body.fields.customfield_36259;
  assert.ok(typeof s3Ref === 'string' && s3Ref.startsWith('s3://'));
  assert.ok(s3Ref.includes(S3_EVENT.Records[0].s3.bucket.name));
  assert.ok(s3Ref.includes(S3_EVENT.Records[0].s3.object.key));
});

await test('downstream: feedback rating=7 → Jira skip (boundary) AND CRM skip (Slack still runs)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'feedback',
    rating: 7,
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 0);
  assert.equal(calls.jiraCreate.length, 0);
  // CRM never opens cases for feedback category (NPS surveys ≠ issues)
  assert.equal(calls.postCase.length, 0, 'NPS feedback never opens CRM case');
  // Slack always runs regardless of category/rating (mirrors all signals)
  assert.equal(calls.slack.length, 1);
});

await test('downstream: feedback rating=5 → Jira runs (mid-NPS), CRM still skipped', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'feedback',
    rating: 5,
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraCreate.length, 1);
  assert.equal(calls.postCase.length, 0, 'feedback rating=5 still does not open CRM case');
  assert.equal(calls.slack.length, 1);
});

await test('downstream: feedback rating=6 → Jira runs (boundary, just below threshold)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'feedback',
    rating: 6,
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraCreate.length, 1);
  assert.equal(calls.postCase.length, 0, 'feedback rating=6 still does not open CRM case');
});

await test('downstream: feedback rating=null → Jira skip AND CRM skip', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'feedback',
    rating: null,
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 0);
  assert.equal(calls.jiraCreate.length, 0);
  assert.equal(calls.postCase.length, 0, 'NPS feedback never opens CRM case');
  assert.equal(calls.slack.length, 1);
});

await test('crm: internal user (3-char shopperId) → CRM SKIPPED even on issue/support category (TLA gate)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'issue',
    shopper_id: 'abc',  // 3-char = internal employee
  });

  await handler(S3_EVENT);

  // CRM blocked for internal users regardless of category
  assert.equal(calls.postCase.length, 0, 'TLA shopperId never opens CRM case');
  // Slack still runs (internal users get visibility, matches UI legacy)
  assert.equal(calls.slack.length, 1);
});

await test('crm: real customer (longer shopperId) on issue category → CRM opens normally', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'issue',
    shopper_id: '7766924',  // 7-char = real customer
  });

  await handler(S3_EVENT);

  // Sanity check the gate doesn't reject real customers
  assert.equal(calls.postCase.length, 1, 'real customer should open CRM case');
});

await test('crm: feedback rating=2 (low NPS) → Jira runs, CRM still SKIPPED (NPS never opens cases)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'feedback',
    rating: 2,
  });

  await handler(S3_EVENT);

  // Jira fires on rating < 7 (eligibility gate, default ON for feedback)
  assert.equal(calls.jiraCreate.length, 1);
  // CRM does NOT — feedback category never opens a case regardless of rating
  assert.equal(calls.postCase.length, 0, 'feedback rating<7 still does not open CRM case');
  // Slack runs
  assert.equal(calls.slack.length, 1);
});

await test('jira: existing issue → findIssueByFeedbackId returns key, createIssue skipped', async () => {
  readStateImpl = freshReadStateImpl();
  findIssueByFeedbackIdImpl = async () => 'AABSP-99';
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, jira_eligibility_config: ENABLE_ALL_JIRA });

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 1);
  assert.equal(calls.jiraCreate.length, 0);
});

await test('jira: createIssue throws → handler still completes; CRM/Slack unaffected', async () => {
  readStateImpl = freshReadStateImpl();
  createIssueImpl = async () => { throw new Error('jira 500'); };
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, jira_eligibility_config: ENABLE_ALL_JIRA });

  await handler(S3_EVENT);

  // Prior fanouts ran fully.
  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
  // Jira attempted but failed.
  assert.equal(calls.jiraFind.length, 1);
  assert.equal(calls.jiraCreate.length, 1);
});

await test('jira: findIssueByFeedbackId throws → handler still completes; createIssue not attempted', async () => {
  readStateImpl = freshReadStateImpl();
  findIssueByFeedbackIdImpl = async () => { throw new Error('jira 401'); };
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, jira_eligibility_config: ENABLE_ALL_JIRA });

  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
  assert.equal(calls.jiraFind.length, 1);
  assert.equal(calls.jiraCreate.length, 0);
});

await test('jira: missing JIRA_CLOUD_ID env → degraded path skips find/create, Slack still posts', async () => {
  readStateImpl = freshReadStateImpl();
  // Enable issue Jira so the handler reaches the JIRA_CLOUD_ID presence check
  // (issue is OFF by default on this branch and would short-circuit earlier).
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, jira_eligibility_config: ENABLE_ALL_JIRA });
  const saved = process.env.JIRA_CLOUD_ID;
  delete process.env.JIRA_CLOUD_ID;

  try {
    await handler(S3_EVENT);
  } finally {
    process.env.JIRA_CLOUD_ID = saved;
  }

  // Misconfig short-circuits before any Jira call — no find, no create.
  assert.equal(calls.jiraFind.length, 0, 'find skipped when JIRA_CLOUD_ID unset');
  assert.equal(calls.jiraCreate.length, 0, 'create skipped when JIRA_CLOUD_ID unset');
  // Slack/CRM continue uninterrupted.
  assert.equal(calls.slack.length, 1, 'Slack still pings on Jira misconfig');
  assert.equal(calls.postCase.length, 1, 'CRM still opens case on Jira misconfig');
});

await test('crm: postCase throws (CMAPI 422 / 5xx) → handler still completes; Slack/Jira run with caseId=null', async () => {
  readStateImpl = freshReadStateImpl();
  postCaseImpl = async () => { throw new Error('CMAPI POST 422: missing contact info'); };
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, jira_eligibility_config: ENABLE_ALL_JIRA });

  // Should not throw — bulkhead pattern matches Slack/Jira.
  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 1, 'postCase attempted once');
  assert.equal(calls.slack.length, 1, 'Slack still pings');
  assert.equal(calls.jiraFind.length, 1, 'Jira still attempted');
  // No kickoff note (removed with the investigator), and none expected with caseId null.
  assert.equal(calls.postNote.length, 0);
});

await test('crm: pre-POST guard hit → reuses existing case, skips postCase, renders Slack link', async () => {
  // Defends against scenarios where postCase appeared to fail to us
  // (30s client abort, network blip, manual replay) but CMAPI server
  // already persisted the case. Without the guard, the next attempt
  // would create a duplicate.
  readStateImpl = freshReadStateImpl();
  getCaseByExternalIdImpl = async () => ({
    caseRecordId: '500U900000TeAPvIAN',
    caseNumber: '00114462',
    status: 'Open',
  });
  // Reused standard 00114462 still has its escalated child 00114463.
  findEscalatedCasesImpl = async () => [
    { caseRecordId: '500ESCALATED114463', caseNumber: '00114463', secondaryCategory: 'Airo AI Builder', isClosed: false },
  ];

  await handler(S3_EVENT);

  assert.equal(calls.getCaseByExternalId.length, 1, 'preflight GET fired once');
  assert.equal(calls.postCase.length, 0, 'postCase skipped on guard hit');
  assert.equal(calls.resolveCase.length, 0, 'resolver skipped on guard hit');
  // Slack rendered with the reused case's ESCALATED child.
  assert.equal(calls.slack.length, 1);
  assert.equal(
    calls.slack[0].enrichment?.crmCaseUrl,
    'https://godaddy2.lightning.force.com/lightning/r/Case/500ESCALATED114463/view',
  );
  assert.equal(calls.slack[0].enrichment?.caseNumber, '00114463');
  // Kickoff note removed with the investigator → no CRM note on the reused case.
  assert.equal(calls.postNote.length, 0);
});

await test('crm: pre-POST guard error → logged, falls through to postCase as normal', async () => {
  // Guard is best-effort; a transient GET failure must not block the
  // primary postCase path. Caught error logged via fanout.crm.preflight_get_failed.
  readStateImpl = freshReadStateImpl();
  getCaseByExternalIdImpl = async () => { throw new Error('CMAPI GET 503'); };

  await handler(S3_EVENT);

  assert.equal(calls.getCaseByExternalId.length, 1);
  assert.equal(calls.postCase.length, 1, 'postCase still ran after guard error');
  assert.equal(calls.slack.length, 1);
});

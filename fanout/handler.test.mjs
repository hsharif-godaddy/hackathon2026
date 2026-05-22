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
let postNoteImpl = async () => {};
let invokeInvestigatorImpl = async () => {};
let postSlackMessageImpl = async () => {};
let findIssueByFeedbackIdImpl = async () => null;
let createIssueImpl = async () => ({ key: 'AABSP-1', id: '10000' });

// `calls` is a stable object — beforeEach mutates `.length = 0` on each
// array rather than reassigning `calls`, so the closures captured by the
// `mock.module` named exports continue to write to the same arrays.
const calls = {
  postCase: [],
  getCase: [],
  postNote: [],
  invoke: [],
  stateRead: [],
  stateWrite: [],
  slack: [],
  jiraFind: [],
  jiraCreate: [],
};

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
    postNote: async (...args) => {
      calls.postNote.push(args[0]);
      return postNoteImpl(...args);
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

mock.module('./invoke-investigator.mjs', {
  namedExports: {
    invokeInvestigator: async (...args) => {
      calls.invoke.push(args[0]);
      return invokeInvestigatorImpl(...args);
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

// jira-mapping.mjs is a pure function with its own dedicated test file.
// We don't mock it here — the handler test exercises the real builder so
// regressions in label/summary shape would show up in the createIssue
// payload assertions below.

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
  // Per-submission Switchboard gate stamped by the BFF. Default fixture
  // is ON so the bulk of fanout tests exercise the full flow; the
  // dedicated `fanout_via_lambda !== true` tests below override this.
  fanout_via_lambda: true,
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
  getCaseImpl = async () => null;
  postNoteImpl = async () => {};
  postSlackMessageImpl = async () => {};
  invokeInvestigatorImpl = async () => {};
  findIssueByFeedbackIdImpl = async () => null;
  createIssueImpl = async () => ({ key: 'AABSP-1', id: '10000' });

  process.env.JIRA_API_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-west-2:111:secret:airo-fanout-jira-api-token';
  process.env.JIRA_BASE_URL = 'https://godaddy-corp.atlassian.net';
  process.env.JIRA_PROJECT_KEY = 'AABSP';

  process.env.FEEDBACK_BUCKET = 'airo-builder-feedback-test';
  process.env.CRM_BASE_URL = 'https://crm.example.com';
  process.env.CRM_CERT_SECRET_ARN = '/Katana/Secrets/airobuilde/app/pre-test/AIRO_CLIENT_CERT';
  process.env.CRM_KEY_SECRET_ARN = '/Katana/Secrets/airobuilde/app/pre-test/AIRO_CLIENT_KEY';
  process.env.AIRO_SSO_ENDPOINT = 'https://sso.example.com/v1/secure/api/token';
  process.env.SLACK_WEBHOOK_SECRET_ARN = 'arn:aws:secretsmanager:us-west-2:111:secret:airo-fanout-slack-webhook';
  process.env.INVESTIGATE_LAMBDA_FN = 'airo-investigator';
  process.env.DEBUG_CONSOLE_BASE_URL = 'https://debug.example.com';
});

await test('fresh path: opens case, writes state, posts Slack + kickoff note + invoke investigator', async () => {
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
  // re-read for etag before writing crmCaseId. This deviates from the plan's stated `=== 1`
  // assertion; the implementation logic is the spec, so we assert 2.
  assert.equal(calls.stateRead.length, 2);
  assert.equal(calls.stateWrite.length, 2);
  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
  assert.equal(calls.postNote.length, 1);
  assert.equal(calls.invoke.length, 1);
  assert.equal(calls.postCase[0].body.externalSystemId, 'airo-cust-1-app-1-sub-1');
  // Slack call routed through buildFormDataFromRow + the issue branch of
  // postSlackMessage — pin the category so a regression that defaults to
  // 'feedback' (which expects rating + comment) is caught here.
  assert.equal(calls.slack[0].category, 'issue');
  assert.deepEqual(calls.slack[0].formData, {
    topics: ['topic-a'],
    description: 'broken thing',
    followUp: true,
  });
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
  assert.equal(calls.invoke.length, 1);
  assert.equal(calls.slack[0].category, 'support');
  assert.deepEqual(calls.slack[0].formData, {
    topics: ['Domain or DNS'],
    description: 'help with my domain',
    followUp: true,
  });
  // Investigator payload mirrors the parquet category — pin it so a
  // regression that drops the field doesn't go unnoticed.
  assert.equal(calls.invoke[0].payload.category, 'support');
});

await test('fresh path: issue category passes category=issue to investigator', async () => {
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
  // Default fixture is already feedback_category: 'issue'.
  await handler(S3_EVENT);

  assert.equal(calls.invoke.length, 1);
  assert.equal(calls.invoke[0].payload.category, 'issue');
});

await test('exits cleanly when row.fanout_via_lambda === false (BFF/UI owns delivery)', async () => {
  parseFeedbackParquetImpl = async () => ({ ...FEEDBACK_ROW, fanout_via_lambda: false });
  await handler(S3_EVENT);
  assert.equal(calls.stateRead.length, 0);
  assert.equal(calls.postCase.length, 0);
  assert.equal(calls.slack.length, 0);
  assert.equal(calls.invoke.length, 0);
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
  assert.equal(calls.invoke.length, 0);
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
  assert.equal(calls.invoke.length, 1);
});

await test('dedup hit within 60min: posts duplicate note + Slack + Jira; skips new CRM case + investigator', async () => {
  const now = Date.now();
  readStateImpl = async () => ({
    state: {
      schemaVersion: 1,
      submissionId: 'old',
      crmCaseId: '500U900000TP4kYIAT',
      startedAt: now - 30 * 60 * 1000,
      lastUpdatedAt: now - 30 * 60 * 1000,
    },
    etag: '"e1"',
  });
  getCaseImpl = async () => ({ caseRecordId: '500U900000TP4kYIAT', status: 'Open' });
  // Jira: spam-click has unique feedback_id so search returns no match → create runs
  findIssueByFeedbackIdImpl = async () => null;

  await handler(S3_EVENT);

  assert.equal(calls.getCase.length, 1);
  assert.equal(calls.postNote.length, 1, 'one duplicate note posted to existing case');
  assert.equal(calls.postCase.length, 0, 'no new CRM case opened on dedup hit');
  assert.equal(calls.invoke.length, 0, 'investigator NOT invoked on dedup hit');
  assert.equal(calls.slack.length, 1, 'Slack still pings on dedup hit');
  assert.equal(calls.jiraCreate.length, 1, 'Jira ticket still created on dedup hit (eligibility-gated)');
});

await test('stale state (case closed): falls through to fresh path', async () => {
  const now = Date.now();
  readStateImpl = async () => ({
    state: {
      schemaVersion: 1,
      submissionId: 'old',
      crmCaseId: '500U900000TP4kYIAT',
      startedAt: now - 10 * 60 * 1000,
      lastUpdatedAt: now - 10 * 60 * 1000,
    },
    etag: '"e1"',
  });
  getCaseImpl = async () => ({ caseRecordId: '500U900000TP4kYIAT', status: 'Closed' });

  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
  assert.equal(calls.invoke.length, 1);
});

await test('expired window (>60min): treats as fresh, overwrites state', async () => {
  const now = Date.now();
  readStateImpl = async () => ({
    state: {
      schemaVersion: 1,
      submissionId: 'old',
      crmCaseId: '500U900000TP4kYIAT',
      startedAt: now - 90 * 60 * 1000,
      lastUpdatedAt: now - 90 * 60 * 1000,
    },
    etag: '"e1"',
  });

  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.invoke.length, 1);
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
        schemaVersion: 1,
        submissionId: 'sub-1',
        crmCaseId: null,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
      },
      etag: '"e-fresh"',
    };
  };
}

await test('jira: issue category → findIssueByFeedbackId then createIssue (Bug)', async () => {
  readStateImpl = freshReadStateImpl();

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 1);
  assert.equal(calls.jiraFind[0].baseUrl, 'https://godaddy-corp.atlassian.net');
  assert.equal(calls.jiraFind[0].projectKey, 'AABSP');
  assert.equal(calls.jiraFind[0].feedbackId, 'sub-1');
  assert.equal(calls.jiraCreate.length, 1);
  assert.equal(calls.jiraCreate[0].baseUrl, 'https://godaddy-corp.atlassian.net');
  assert.equal(calls.jiraCreate[0].body.fields.issuetype.name, 'Bug');
  assert.equal(calls.jiraCreate[0].body.fields.project.key, 'AABSP');
});

await test('jira: support category → createIssue called (Task)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'support',
    feedback_text: 'help with my domain',
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 1);
  assert.equal(calls.jiraCreate.length, 1);
  assert.equal(calls.jiraCreate[0].body.fields.issuetype.name, 'Task');
});

await test('jira: feedback rating=3 → createIssue called with rating-3 label', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'feedback',
    rating: 3,
    feedback_text: 'meh',
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraCreate.length, 1);
  assert.ok(calls.jiraCreate[0].body.fields.labels.includes('rating-3'));
  assert.ok(calls.jiraCreate[0].body.fields.labels.includes('feedback-id-sub-1'));
});

await test('downstream: feedback rating=5 → eligibility skip for Jira AND investigator AND CRM (Slack still runs)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'feedback',
    rating: 5,
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 0);
  assert.equal(calls.jiraCreate.length, 0);
  // Investigator shares same gate as Jira — happy NPS = no investigation
  assert.equal(calls.invoke.length, 0);
  // CRM never opens cases for feedback category (NPS surveys ≠ issues)
  assert.equal(calls.postCase.length, 0, 'NPS feedback never opens CRM case');
  // Slack always runs regardless of category/rating (mirrors all signals)
  assert.equal(calls.slack.length, 1);
});

await test('downstream: feedback rating=null → eligibility skip for Jira AND investigator AND CRM', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'feedback',
    rating: null,
  });

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 0);
  assert.equal(calls.jiraCreate.length, 0);
  assert.equal(calls.invoke.length, 0);
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

await test('crm: feedback rating=2 (low NPS) → Jira + investigator run, CRM still SKIPPED (NPS never opens cases)', async () => {
  readStateImpl = freshReadStateImpl();
  parseFeedbackParquetImpl = async () => ({
    ...FEEDBACK_ROW,
    feedback_category: 'feedback',
    rating: 2,
  });

  await handler(S3_EVENT);

  // Jira + investigator fire on rating < 5 (eligibility gate)
  assert.equal(calls.jiraCreate.length, 1);
  assert.equal(calls.invoke.length, 1);
  // CRM does NOT — feedback category never opens a case regardless of rating
  assert.equal(calls.postCase.length, 0, 'feedback rating<5 still does not open CRM case');
  // Slack runs
  assert.equal(calls.slack.length, 1);
});

await test('jira: existing issue → findIssueByFeedbackId returns key, createIssue skipped', async () => {
  readStateImpl = freshReadStateImpl();
  findIssueByFeedbackIdImpl = async () => 'AABSP-99';

  await handler(S3_EVENT);

  assert.equal(calls.jiraFind.length, 1);
  assert.equal(calls.jiraCreate.length, 0);
});

await test('jira: createIssue throws → handler still completes; CRM/Slack/invoke unaffected', async () => {
  readStateImpl = freshReadStateImpl();
  createIssueImpl = async () => { throw new Error('jira 500'); };

  await handler(S3_EVENT);

  // Prior fanouts ran fully.
  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
  assert.equal(calls.invoke.length, 1);
  // Jira attempted but failed.
  assert.equal(calls.jiraFind.length, 1);
  assert.equal(calls.jiraCreate.length, 1);
});

await test('jira: findIssueByFeedbackId throws → handler still completes; createIssue not attempted', async () => {
  readStateImpl = freshReadStateImpl();
  findIssueByFeedbackIdImpl = async () => { throw new Error('jira 401'); };

  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
  assert.equal(calls.invoke.length, 1);
  assert.equal(calls.jiraFind.length, 1);
  assert.equal(calls.jiraCreate.length, 0);
});

await test('crm: postCase throws (CMAPI 422 / 5xx) → handler still completes; Slack/invoke/Jira run with caseId=null', async () => {
  readStateImpl = freshReadStateImpl();
  postCaseImpl = async () => { throw new Error('CMAPI POST 422: missing contact info'); };

  // Should not throw — bulkhead pattern matches Slack/Jira/investigator.
  await handler(S3_EVENT);

  assert.equal(calls.postCase.length, 1, 'postCase attempted once');
  assert.equal(calls.slack.length, 1, 'Slack still pings');
  assert.equal(calls.invoke.length, 1, 'investigator still invoked');
  assert.equal(calls.jiraFind.length, 1, 'Jira still attempted');
  // Investigator payload has no crmCaseId (no case was created).
  const invokePayload = calls.invoke[0].payload;
  assert.equal(invokePayload.crmCaseId, undefined);
  assert.equal(invokePayload.crmCaseNumber, undefined);
  // Kickoff note skipped because caseId is null.
  // postNote was NOT called (no kickoff post when caseId null).
  assert.equal(calls.postNote.length, 0);
});

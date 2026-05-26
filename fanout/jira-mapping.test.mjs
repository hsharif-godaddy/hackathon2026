import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildJiraIssueBody } from './jira-mapping.mjs';

const PROJECT_KEY = 'AABSP';
const S3_REF = 's3://airo-builder-feedback-prod/feedback/year=2026/month=05/day=26/hour=15/cust-1/fb-uuid-abc.parquet';

const BASE_ROW = {
  customer_id: 'cust-1',
  app_id: 'app-1',
  feedback_id: 'fb-uuid-abc',
  feedback_origin_name: 'Publish banner',
  feedback_category: 'issue',
  rating: null,
  feedback_text: 'broken thing',
  feedback_topic_list: '["AI assistant", "Editor & design"]',
  consent_flag: true,
  subscription_info: 'Starter - 168/400',
  experiments_line: '<https://hivemind.gdcorp.tools/experiments/aa-airo-builder|aa-airo-builder>: on\n<https://hivemind.gdcorp.tools/experiments/airo-build-initial-agent|airo-build-initial-agent>: initial_agent_v3',
};

const CF = {
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

const AIRO_ENG_SUPPORT_TEAM_ID = '9116cafc-8bf6-489f-ac38-8a2d6a5b3952';

await test('issue category → Bug', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields.issuetype.name, 'Bug');
  assert.equal(body.fields.project.key, 'AABSP');
});

await test('support category → SOS Support', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_category: 'support' }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields.issuetype.name, 'SOS Support');
});

await test('feedback category → Prod Feedback', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_category: 'feedback', rating: 3 }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields.issuetype.name, 'Prod Feedback');
});

await test('summary truncated to 80 chars with ellipsis when too long', () => {
  const longText = 'x'.repeat(200);
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_text: longText }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields.summary.length, 80);
  assert.ok(body.fields.summary.endsWith('…'));
});

await test('summary kept verbatim when ≤80 chars', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_text: 'short text' }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields.summary, 'short text');
});

await test('empty feedback_text + issue → "Bug | App ID - <id>" fallback', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_text: '' }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields.summary, 'Bug | App ID - app-1');
});

await test('empty feedback_text + support → "SOS | App ID - <id>" fallback', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_category: 'support', feedback_text: '' },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(body.fields.summary, 'SOS | App ID - app-1');
});

await test('empty feedback_text + feedback → "Feedback | App ID - <id>" fallback', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_category: 'feedback', rating: 2, feedback_text: '' },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(body.fields.summary, 'Feedback | App ID - app-1');
});

await test('null/missing feedback_text falls back to fallback summary', () => {
  const row = { ...BASE_ROW };
  delete row.feedback_text;
  const body = buildJiraIssueBody(row, PROJECT_KEY, S3_REF);
  assert.equal(body.fields.summary, 'Bug | App ID - app-1');
});

await test('fallback summary uses "unknown" when app_id missing', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, app_id: null, feedback_text: '' },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(body.fields.summary, 'Bug | App ID - unknown');
});

await test('labels: AAB-App only — dedup now rides on Feedback ID custom field', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.deepEqual(body.fields.labels, ['AAB-App']);
});

await test('labels stay AAB-App-only even when feedback_id missing', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_id: null }, PROJECT_KEY, S3_REF);
  assert.deepEqual(body.fields.labels, ['AAB-App']);
});

await test('labels do NOT include customer-id (PII)', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.ok(!body.fields.labels.some((l) => l.startsWith('customer-')));
});

await test('Team custom field always set to Airo Engineering Support UUID (plain string)', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields[CF.team], AIRO_ENG_SUPPORT_TEAM_ID);
});

await test('Team custom field set on every category (Bug / SOS / Prod Feedback)', () => {
  for (const cat of ['issue', 'support', 'feedback']) {
    const body = buildJiraIssueBody(
      { ...BASE_ROW, feedback_category: cat, rating: cat === 'feedback' ? 3 : null },
      PROJECT_KEY, S3_REF,
    );
    assert.equal(body.fields[CF.team], AIRO_ENG_SUPPORT_TEAM_ID);
  }
});

await test('App ID custom field populated', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields[CF.appId], 'app-1');
});

await test('Subscription/Plan custom field populated as-is from row', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields[CF.subscriptionPlan], 'Starter - 168/400');
});

await test('Origin custom field populated as-is (already pretty)', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields[CF.origin], 'Publish banner');
});

await test('Topics: spaces in pretty display strings collapsed to hyphens (Jira label rule)', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.deepEqual(body.fields[CF.topics], ['AI-assistant', 'Editor-&-design']);
});

await test('Topics: multi-word topic with internal spaces hyphenated (regression: 400 from Jira)', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_topic_list: '["Publishing my site", "Account or login"]' },
    PROJECT_KEY, S3_REF,
  );
  assert.deepEqual(body.fields[CF.topics], ['Publishing-my-site', 'Account-or-login']);
});

await test('Topics field omitted when array empty', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_topic_list: '[]' }, PROJECT_KEY, S3_REF);
  assert.equal(CF.topics in body.fields, false);
});

await test('Customer Consent set to [{value:"Yes"}] when consent_flag true', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.deepEqual(body.fields[CF.customerConsent], [{ value: 'Yes' }]);
});

await test('Customer Consent omitted when consent_flag false', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, consent_flag: false }, PROJECT_KEY, S3_REF);
  assert.equal(CF.customerConsent in body.fields, false);
});

await test('Customer Consent omitted when consent_flag null', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, consent_flag: null }, PROJECT_KEY, S3_REF);
  assert.equal(CF.customerConsent in body.fields, false);
});

await test('Feedback ID custom field populated', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields[CF.feedbackId], 'fb-uuid-abc');
});

await test('S3 Object Reference populated from caller-supplied URI', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields[CF.s3ObjectReference], S3_REF);
});

await test('S3 Object Reference omitted when caller passes no s3Ref', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY);
  assert.equal(CF.s3ObjectReference in body.fields, false);
});

await test('Experiments: ADF doc, experiment name rendered as link mark + plain ": cohort" tail', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  const exp = body.fields[CF.experiments];
  assert.equal(exp.type, 'doc');
  assert.equal(exp.version, 1);
  assert.equal(exp.content.length, 2);

  const first = exp.content[0];
  assert.equal(first.type, 'paragraph');
  assert.deepEqual(first.content[0], {
    type: 'text',
    text: 'aa-airo-builder',
    marks: [{ type: 'link', attrs: { href: 'https://hivemind.gdcorp.tools/experiments/aa-airo-builder' } }],
  });
  assert.deepEqual(first.content[1], { type: 'text', text: ': on' });

  const second = exp.content[1];
  assert.deepEqual(second.content[0], {
    type: 'text',
    text: 'airo-build-initial-agent',
    marks: [{ type: 'link', attrs: { href: 'https://hivemind.gdcorp.tools/experiments/airo-build-initial-agent' } }],
  });
  assert.deepEqual(second.content[1], { type: 'text', text: ': initial_agent_v3' });
});

await test('Experiments: line without mrkdwn link falls back to plain paragraph', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, experiments_line: 'plain-key: cohort' },
    PROJECT_KEY, S3_REF,
  );
  const exp = body.fields[CF.experiments];
  assert.equal(exp.content.length, 1);
  assert.deepEqual(exp.content[0], {
    type: 'paragraph',
    content: [{ type: 'text', text: 'plain-key: cohort' }],
  });
});

await test('Experiments field omitted when experiments_line empty', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, experiments_line: '' }, PROJECT_KEY, S3_REF);
  assert.equal(CF.experiments in body.fields, false);
});

await test('Experiments field omitted when experiments_line null', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, experiments_line: null }, PROJECT_KEY, S3_REF);
  assert.equal(CF.experiments in body.fields, false);
});

await test('Rating populated as {value:"N/7"} for feedback rating=3', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_category: 'feedback', rating: 3 },
    PROJECT_KEY, S3_REF,
  );
  assert.deepEqual(body.fields[CF.rating], { value: '3/7' });
});

await test('Rating populated for rating=0 (boundary)', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_category: 'feedback', rating: 0 },
    PROJECT_KEY, S3_REF,
  );
  assert.deepEqual(body.fields[CF.rating], { value: '0/7' });
});

await test('Rating omitted when category != feedback (Bug/SOS exclude it)', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_category: 'issue', rating: 3 },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(CF.rating in body.fields, false);
});

await test('Rating omitted when feedback row has rating=null', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_category: 'feedback', rating: null },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(CF.rating in body.fields, false);
});

await test('Rating omitted when out-of-range (8)', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_category: 'feedback', rating: 8 },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(CF.rating in body.fields, false);
});

await test('Description is a valid ADF doc', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields.description.type, 'doc');
  assert.equal(body.fields.description.version, 1);
  assert.ok(Array.isArray(body.fields.description.content));
});

await test('Description renders feedback as prose paragraphs (one per line, no codeBlock)', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_text: 'multi\nline\nfeedback' },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(body.fields.description.content.length, 3);
  assert.deepEqual(
    body.fields.description.content.map((p) => p.content[0].text),
    ['multi', 'line', 'feedback'],
  );
  assert.ok(!body.fields.description.content.some((n) => n.type === 'codeBlock'));
});

await test('Description with single-line feedback → single paragraph', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_text: 'one liner' },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(body.fields.description.content.length, 1);
  assert.equal(body.fields.description.content[0].type, 'paragraph');
  assert.equal(body.fields.description.content[0].content[0].text, 'one liner');
});

await test('Description is empty doc when feedback_text empty (custom fields carry context)', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_text: '' },
    PROJECT_KEY, S3_REF,
  );
  assert.deepEqual(body.fields.description, { type: 'doc', version: 1, content: [] });
});

await test('Description does NOT duplicate customer_id / app_id / origin / topics / subscription', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  const flat = JSON.stringify(body.fields.description);
  assert.ok(!flat.includes('Customer:'), 'customer_id leaked into description');
  assert.ok(!flat.includes('App:'), 'app_id leaked into description');
  assert.ok(!flat.includes('Submission ID:'), 'feedback_id leaked into description');
  assert.ok(!flat.includes('Category:'), 'category leaked into description');
  assert.ok(!flat.includes('Origin:'), 'origin leaked into description');
  assert.ok(!flat.includes('Topics:'), 'topics leaked into description');
  assert.ok(!flat.includes('Subscription'), 'subscription leaked into description');
  assert.ok(!flat.includes('Rating:'), 'rating leaked into description');
});

await test('priority and reporter NOT set', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY, S3_REF);
  assert.equal(body.fields.priority, undefined);
  assert.equal(body.fields.reporter, undefined);
});

await test('project.key uses caller-supplied value (override-able)', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, 'OTHER', S3_REF);
  assert.equal(body.fields.project.key, 'OTHER');
});

await test('Optional fields omitted when row values null/empty', () => {
  const body = buildJiraIssueBody(
    {
      customer_id: 'cust-1',
      app_id: 'app-1',
      feedback_id: 'fb-1',
      feedback_category: 'feedback',
      rating: 2,
      feedback_text: 'minimal',
      feedback_topic_list: null,
      consent_flag: false,
      subscription_info: null,
      feedback_origin_name: null,
      experiments_line: null,
    },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(CF.subscriptionPlan in body.fields, false);
  assert.equal(CF.origin in body.fields, false);
  assert.equal(CF.topics in body.fields, false);
  assert.equal(CF.customerConsent in body.fields, false);
  assert.equal(CF.experiments in body.fields, false);
  // App ID, Feedback ID, S3 Ref still present
  assert.equal(body.fields[CF.appId], 'app-1');
  assert.equal(body.fields[CF.feedbackId], 'fb-1');
  assert.equal(body.fields[CF.s3ObjectReference], S3_REF);
});

await test('Topics: malformed-JSON string returns empty (defensive)', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_topic_list: 'not, valid, json' },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(CF.topics in body.fields, false);
});

await test('Topics: malformed-JSON emits fanout.jira.topics.parse_failed warn (no PII)', () => {
  const captured = [];
  const orig = console.log;
  console.log = (line) => captured.push(line);
  try {
    buildJiraIssueBody(
      { ...BASE_ROW, feedback_topic_list: 'not valid json {' },
      PROJECT_KEY, S3_REF,
    );
  } finally {
    console.log = orig;
  }

  const warn = captured.find((l) => l.includes('fanout.jira.topics.parse_failed'));
  assert.ok(warn, 'parse_failed warn emitted on malformed JSON');
  const parsed = JSON.parse(warn);
  assert.equal(parsed.level, 'warn');
  assert.equal(parsed.rawType, 'string');
  assert.equal(parsed.rawLength, 16);
  assert.equal(parsed.errorName, 'SyntaxError');
  // PII-safety: the raw value and parser error.message must NOT appear
  // in the warn payload — JSON.parse errors echo input position context
  // ("Unexpected token X in JSON at position N") which would leak any
  // customer text a misconfigured producer wrote into this column.
  assert.equal(parsed.raw, undefined);
  assert.equal(parsed.error, undefined);
  assert.ok(!warn.includes('not valid json'));
});

await test('Topics: non-string entries (object, number) silently dropped', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_topic_list: '["valid topic", {"oops": "obj"}, 42, null]' },
    PROJECT_KEY, S3_REF,
  );
  assert.deepEqual(body.fields[CF.topics], ['valid-topic']);
});

await test('Unknown feedback_category falls back to Bug (defensive — should never hit in prod)', () => {
  const body = buildJiraIssueBody(
    { ...BASE_ROW, feedback_category: 'mystery-category', feedback_text: 'x' },
    PROJECT_KEY, S3_REF,
  );
  assert.equal(body.fields.issuetype.name, 'Bug');
});

await test('Experiments: indented mrkdwn link still produces ADF link mark (regex tolerates ^\\s*)', () => {
  const body = buildJiraIssueBody(
    {
      ...BASE_ROW,
      experiments_line: '  <https://hivemind.gdcorp.tools/experiments/foo|foo>: bar',
    },
    PROJECT_KEY, S3_REF,
  );
  const para = body.fields[CF.experiments].content[0];
  assert.equal(para.content[0].text, 'foo');
  assert.equal(para.content[0].marks[0].type, 'link');
});

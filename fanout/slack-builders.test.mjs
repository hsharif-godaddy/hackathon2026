import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFormDataFromRow } from './handler.mjs';
import {
  buildSupportRequestBlocks,
  buildBugReportBlocks,
  buildCustomerFeedbackBlocks,
  buildFeedbackBlocks,
} from './slack-builders.mjs';

/**
 * Block Kit shape tests for the fanout Lambda's Slack builders (the
 * canonical copy since the UI's slackBuilders.ts was removed). Expected
 * shapes are hand-written so any drift surfaces immediately.
 */

await test('buildSupportRequestBlocks: compact shape — Subscription + Origin + Details deep-link', () => {
  const data = { topics: ['ui', 'publish'], description: 'broken', followUp: true };
  const origin = 'first-publish-banner';
  const ctx = {
    currentAppId: 'app-1',
    previewUrl: 'https://preview.airo-builder.test-godaddy.com/?airoShareToken=abc',
    publishedUrl: 'https://example.com',
    fullStoryUrl: 'https://app.fullstory.com/some-session',
    subscriptionInfo: 'Pro Annual / Active',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: '12345',
    experimentsLine: 'exp1=A, exp2=B',
    customerId: 'cust-1',
    feedbackUuid: 'fb-uuid-s',
  };

  const result = buildSupportRequestBlocks(data, origin, ctx);

  assert.deepEqual(result, {
    title: ':sos: Support Request',
    twoColumnSection: {
      leftFields: [{ label: 'Subscription', value: 'Pro Annual / Active' }],
      rightFields: [{ label: 'Origin', value: 'first-publish-banner' }],
    },
    singleColumnSections: [
      { label: 'Description', value: 'broken' },
      { value: '_We\'ll reply to the email on the customer\'s GoDaddy account._' },
    ],
    links: [
      { text: 'app-1' },
      { url: 'https://preview.airo-builder.test-godaddy.com/?airoShareToken=abc', text: 'Preview' },
      { url: 'https://example.com', text: 'Published' },
      { url: 'https://app.fullstory.com/some-session', text: 'FS' },
      { url: 'https://console.airo-builder.godaddy.com/?appId=app-1', text: 'Console' },
      { url: 'https://console.airo-builder.godaddy.com/?customerId=cust-1&appId=app-1&tab=feedback&feedbackId=fb-uuid-s', text: 'Details' },
    ],
  });
});

await test('buildSupportRequestBlocks: blank description + no subscription/origin → undefined twoColumnSection', () => {
  const data = { topics: [], description: '', followUp: false };
  const ctx = {
    currentAppId: 'app-only',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildSupportRequestBlocks(data, undefined, ctx);

  assert.equal(result.twoColumnSection, undefined);
  // Description omitted when blank, but the canned closing line always present
  assert.deepEqual(result.singleColumnSections, [
    { value: '_We\'ll reply to the email on the customer\'s GoDaddy account._' },
  ]);
});

await test('buildBugReportBlocks: compact shape — Origin-only twoColumnSection when subscription absent + Details deep-link', () => {
  const data = { topics: ['rendering'], description: 'crash on save', followUp: false };
  const origin = 'develop-page';
  const ctx = {
    currentAppId: 'app-2',
    previewUrl: 'https://preview.example/p?airoShareToken=t',
    publishedUrl: undefined,
    fullStoryUrl: 'https://fs/2',
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
    customerId: 'cust-2',
    feedbackUuid: 'fb-uuid-b',
  };

  const result = buildBugReportBlocks(data, origin, ctx);

  assert.deepEqual(result, {
    title: ':bug: Bug Report',
    twoColumnSection: {
      leftFields: [{ label: ' ', value: ' ' }],
      rightFields: [{ label: 'Origin', value: 'develop-page' }],
    },
    singleColumnSections: [
      { label: 'What Happened', value: 'crash on save' },
    ],
    links: [
      { text: 'app-2' },
      { url: 'https://preview.example/p?airoShareToken=t', text: 'Preview' },
      { url: 'https://fs/2', text: 'FS' },
      { url: 'https://console.airo-builder.godaddy.com/?appId=app-2', text: 'Console' },
      { url: 'https://console.airo-builder.godaddy.com/?customerId=cust-2&appId=app-2&tab=feedback&feedbackId=fb-uuid-b', text: 'Details' },
    ],
  });
});

await test('buildBugReportBlocks: impersonating decorates the title with CRM-skip suffix', () => {
  const data = { topics: [], description: 'x', followUp: false };
  const ctx = {
    currentAppId: 'app-3',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: true,
    isInternalUser: false,
    shopperId: '99887',
  };

  const result = buildBugReportBlocks(data, undefined, ctx);

  assert.equal(result.title, ':bug: Bug Report - :no_entry_sign: CRM skip (99887)');
  // No subscription, no origin → no two-column section.
  assert.equal(result.twoColumnSection, undefined);
});

await test('buildFeedbackBlocks: rating 7 → title carries rating, body has Subscription + Origin and comment', () => {
  const data = { rating: 7, topics: ['ai'], comment: 'love it', customerConsent: true };
  const ctx = {
    currentAppId: 'app-f',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: 'Professional - 696/1050',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: '12345',
    customerId: 'cust-9',
    feedbackUuid: 'fb-uuid-1',
  };

  const result = buildFeedbackBlocks(data, 'first-publish-banner', ctx);

  assert.deepEqual(result, {
    title: ':speech_balloon: Product Feedback - 7/7 :star-struck:',
    twoColumnSection: {
      leftFields: [{ label: 'Subscription', value: 'Professional - 696/1050' }],
      rightFields: [{ label: 'Origin', value: 'first-publish-banner' }],
    },
    singleColumnSections: [
      { value: '> love it' },
    ],
    links: [
      { text: 'app-f' },
      { url: 'https://console.airo-builder.godaddy.com/?appId=app-f', text: 'Console' },
      { url: 'https://console.airo-builder.godaddy.com/?customerId=cust-9&appId=app-f&tab=feedback&feedbackId=fb-uuid-1', text: 'Details' },
    ],
  });
});

await test('buildFeedbackBlocks: impersonating session → No score in title, body has only comment (or none)', () => {
  const data = { rating: 5, topics: [], comment: '', customerConsent: false };
  const ctx = {
    currentAppId: null,
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: true,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildFeedbackBlocks(data, undefined, ctx);

  assert.equal(result.title, ':speech_balloon: Product Feedback - :no_entry_sign: No score (E2S session)');
  assert.equal(result.twoColumnSection, undefined);
  assert.equal(result.singleColumnSections, undefined);
});

await test('buildFeedbackBlocks: internal user → No score (TLA account) in title', () => {
  const data = { rating: 5, topics: [], comment: '', customerConsent: true };
  const ctx = {
    currentAppId: null,
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: true,
    shopperId: '12345',
  };

  const result = buildFeedbackBlocks(data, undefined, ctx);

  assert.equal(result.title, ':speech_balloon: Product Feedback - :no_entry_sign: No score (TLA account (12345))');
});

await test('buildFeedbackBlocks: rating 4 + empty comment → title only, no body sections', () => {
  const data = { rating: 4, topics: [], comment: '', customerConsent: false };
  const ctx = {
    currentAppId: null,
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildFeedbackBlocks(data, undefined, ctx);
  assert.equal(result.title, ':speech_balloon: Product Feedback - 4/7 :neutral_face:');
  assert.equal(result.twoColumnSection, undefined);
  assert.equal(result.singleColumnSections, undefined);
  // No appId → no Details link.
  assert.equal(result.links.find((l) => l.text === 'Details'), undefined);
});

await test('buildFeedbackBlocks: multiline comment is line-wise blockquoted', () => {
  const data = { rating: 6, topics: [], comment: 'line one\nline two\nline three', customerConsent: true };
  const ctx = {
    currentAppId: 'app-m',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildFeedbackBlocks(data, undefined, ctx);
  assert.equal(result.title, ':speech_balloon: Product Feedback - 6/7 :smile:');
  assert.deepEqual(result.singleColumnSections, [
    { value: '> line one\n> line two\n> line three' },
  ]);
});

await test('buildFeedbackBlocks: Details link omits feedbackId / customerId when missing', () => {
  const data = { rating: 5, topics: [], comment: '', customerConsent: false };
  const ctx = {
    currentAppId: 'app-x',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildFeedbackBlocks(data, undefined, ctx);
  const details = result.links.find((l) => l.text === 'Details');
  assert.equal(details.url, 'https://console.airo-builder.godaddy.com/?appId=app-x&tab=feedback');
});

// ---- buildFormDataFromRow → builder integration tests ----
// These tests exercise the real Lambda data path: parquet row → buildFormDataFromRow
// → builder. The unit tests above bypass this transform and can stay green even
// when the two layers have a mismatched contract (e.g. description vs comment).

await test('buildFormDataFromRow + buildCustomerFeedbackBlocks: feedback_text lands in comment and renders in blockquote', () => {
  const formData = buildFormDataFromRow({
    feedback_category: 'customer-feedback',
    feedback_text: 'inline comment from customer',
    feedback_topic_list: '["Other"]',
    consent_flag: false,
    rating: null,
  });

  // This assertion would have FAILED before the buildFormDataFromRow fix:
  // 'customer-feedback' fell to the else branch → { description: text }
  // buildCustomerFeedbackBlocks only reads data.comment → blockquote silently omitted.
  assert.equal(formData.comment, 'inline comment from customer');
  assert.equal(formData.description, undefined);

  const ctx = {
    currentAppId: 'app-1',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildCustomerFeedbackBlocks(formData, undefined, ctx);

  assert.deepEqual(result.singleColumnSections, [
    { value: '> inline comment from customer' },
  ]);
});

await test('buildFormDataFromRow + buildCustomerFeedbackBlocks: parsed topic flows through to Reason field', () => {
  const formData = buildFormDataFromRow({
    feedback_category: 'customer-feedback',
    feedback_text: '',
    feedback_topic_list: '["Not accurate"]',
    consent_flag: false,
    rating: null,
  });

  assert.deepEqual(formData.topics, ['Not accurate']);

  const ctx = {
    currentAppId: 'app-1',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildCustomerFeedbackBlocks(formData, 'develop-page', ctx);

  const rightFields = result.twoColumnSection.rightFields;
  assert.deepEqual(rightFields, [
    { label: 'Origin', value: 'develop-page' },
    { label: 'Reason', value: 'Not accurate' },
  ]);
});

await test('buildFormDataFromRow + buildCustomerFeedbackBlocks: empty feedback_text → no singleColumnSections', () => {
  const formData = buildFormDataFromRow({
    feedback_category: 'customer-feedback',
    feedback_text: '',
    feedback_topic_list: '[]',
    consent_flag: false,
    rating: null,
  });

  const ctx = {
    currentAppId: null,
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildCustomerFeedbackBlocks(formData, undefined, ctx);

  assert.equal(result.singleColumnSections, undefined);
});

await test('buildFormDataFromRow: feedback category maps feedback_text → comment', () => {
  const result = buildFormDataFromRow({
    feedback_category: 'feedback',
    feedback_text: 'nps comment',
    feedback_topic_list: '[]',
    consent_flag: true,
    rating: 5,
  });

  assert.equal(result.comment, 'nps comment');
  assert.equal(result.description, undefined);
  assert.equal(result.rating, 5);
});

await test('buildFormDataFromRow: issue category maps feedback_text → description', () => {
  const result = buildFormDataFromRow({
    feedback_category: 'issue',
    feedback_text: 'something broke',
    feedback_topic_list: '[]',
    consent_flag: true,
    rating: null,
  });

  assert.equal(result.description, 'something broke');
  assert.equal(result.comment, undefined);
});

// ---- buildCustomerFeedbackBlocks tests ----

await test('buildCustomerFeedbackBlocks: base title with no rating, body has comment blockquoted', () => {
  const data = { rating: 5, topics: [], comment: 'pretty good', customerConsent: true };
  const ctx = {
    currentAppId: 'app-cf',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: 'Pro Annual / Active',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: '12345',
    customerId: 'cust-cf',
    feedbackUuid: 'fb-uuid-cf',
  };

  const result = buildCustomerFeedbackBlocks(data, 'develop-page', ctx);

  assert.equal(result.title, ':thumbsdown::skin-tone-2: Customer Feedback ( Inline )');
  assert.deepEqual(result.twoColumnSection, {
    leftFields: [{ label: 'Subscription', value: 'Pro Annual / Active' }],
    rightFields: [{ label: 'Origin', value: 'develop-page' }],
  });
  assert.deepEqual(result.singleColumnSections, [{ value: '> pretty good' }]);
  assert.ok(result.links.find((l) => l.text === 'Details'));
});

await test('buildCustomerFeedbackBlocks: topic in data.topics renders as Reason field beside Origin', () => {
  const data = { rating: null, topics: ['Not accurate'], comment: '', customerConsent: false };
  const ctx = {
    currentAppId: 'app-r',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: 'Pro Monthly / Active',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: '55555',
  };

  const result = buildCustomerFeedbackBlocks(data, 'develop-page', ctx);

  assert.deepEqual(result.twoColumnSection, {
    leftFields: [{ label: 'Subscription', value: 'Pro Monthly / Active' }],
    rightFields: [
      { label: 'Origin', value: 'develop-page' },
      { label: 'Reason', value: 'Not accurate' },
    ],
  });
  assert.equal(result.singleColumnSections, undefined);
});

await test('buildCustomerFeedbackBlocks: empty topics array → no Reason field', () => {
  const data = { rating: null, topics: [], comment: '', customerConsent: false };
  const ctx = {
    currentAppId: 'app-r',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: 'Pro Monthly / Active',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: '55555',
  };

  const result = buildCustomerFeedbackBlocks(data, 'develop-page', ctx);

  assert.deepEqual(result.twoColumnSection, {
    leftFields: [{ label: 'Subscription', value: 'Pro Monthly / Active' }],
    rightFields: [{ label: 'Origin', value: 'develop-page' }],
  });
});

await test('buildCustomerFeedbackBlocks: impersonating session → No score in title', () => {
  const data = { rating: 4, topics: [], comment: '', customerConsent: false };
  const ctx = {
    currentAppId: null,
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: true,
    isInternalUser: false,
    shopperId: '99887',
  };

  const result = buildCustomerFeedbackBlocks(data, undefined, ctx);

  assert.equal(
    result.title,
    ':thumbsdown::skin-tone-2: Customer Feedback ( Inline ) - :no_entry_sign: No score (E2S session)',
  );
  assert.equal(result.twoColumnSection, undefined);
  assert.equal(result.singleColumnSections, undefined);
});

await test('buildCustomerFeedbackBlocks: internal user (TLA) → No score in title', () => {
  const data = { rating: 3, topics: [], comment: '', customerConsent: true };
  const ctx = {
    currentAppId: null,
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: true,
    shopperId: 'abc',
  };

  const result = buildCustomerFeedbackBlocks(data, undefined, ctx);

  assert.equal(
    result.title,
    ':thumbsdown::skin-tone-2: Customer Feedback ( Inline ) - :no_entry_sign: No score (TLA account (abc))',
  );
});

await test('buildCustomerFeedbackBlocks: rating is ignored — title never carries a score', () => {
  const data = { rating: 7, topics: [], comment: '', customerConsent: false };
  const ctx = {
    currentAppId: null,
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildCustomerFeedbackBlocks(data, undefined, ctx);

  assert.equal(result.title, ':thumbsdown::skin-tone-2: Customer Feedback ( Inline )');
  assert.equal(result.singleColumnSections, undefined);
});

await test('buildCustomerFeedbackBlocks: multiline comment is line-wise blockquoted', () => {
  const data = { rating: 6, topics: [], comment: 'line one\nline two\nline three', customerConsent: true };
  const ctx = {
    currentAppId: 'app-ml',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildCustomerFeedbackBlocks(data, undefined, ctx);

  assert.equal(result.title, ':thumbsdown::skin-tone-2: Customer Feedback ( Inline )');
  assert.deepEqual(result.singleColumnSections, [
    { value: '> line one\n> line two\n> line three' },
  ]);
});

await test('buildCustomerFeedbackBlocks: enrichment triage links appear between App ID and diagnostic links', () => {
  const enrichment = {
    crmCaseUrl: 'https://godaddy2.lightning.force.com/lightning/r/Case/500U900000TUb7vIAD/view',
    caseNumber: '00012345',
    jiraKey: 'AABSP-77',
    jiraUrl: 'https://godaddy-corp.atlassian.net/browse/AABSP-77',
  };
  const ctx = {
    currentAppId: 'app-enr',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildCustomerFeedbackBlocks(
    { rating: 2, topics: [], comment: 'bad', customerConsent: true },
    undefined,
    ctx,
    enrichment,
  );

  assert.equal(result.links[0].text, 'app-enr');
  assert.equal(result.links[0].url, undefined);
  assert.equal(result.links[1].text, 'Case #00012345');
  assert.equal(result.links[1].url, enrichment.crmCaseUrl);
  assert.equal(result.links[2].text, 'Jira');
  assert.equal(result.links[2].url, enrichment.jiraUrl);
});

await test('buildDiagnosticLinks: publishedUrl with "test-" omitted', () => {
  const data = { topics: [], description: 'x', followUp: false };
  const ctx = {
    currentAppId: 'app-x',
    previewUrl: 'https://preview',
    publishedUrl: 'https://my-app.test-godaddy.com',
    fullStoryUrl: null,
    subscriptionInfo: '',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: undefined,
  };

  const result = buildBugReportBlocks(data, undefined, ctx);

  // 'Published' must NOT appear in links because publishedUrl contains 'test-'
  assert.equal(result.links.find(l => l.text === 'Published'), undefined);
  // Preview and Console should still be present
  assert.equal(result.links.find(l => l.text === 'Preview').url, 'https://preview');
  assert.equal(
    result.links.find(l => l.text === 'Console').url,
    'https://console.airo-builder.godaddy.com/?appId=app-x',
  );
});

// ---- Triage-link enrichment tests ----

const MIN_CTX = {
  currentAppId: 'app-1',
  previewUrl: undefined,
  publishedUrl: undefined,
  fullStoryUrl: null,
  subscriptionInfo: '',
  isImpersonating: false,
  isInternalUser: false,
  shopperId: undefined,
};

await test('enrichment: both triage links sit between App ID label and diagnostic links', () => {
  const enrichment = {
    crmCaseUrl: 'https://godaddy2.lightning.force.com/lightning/r/Case/500U900000TUb7vIAD/view',
    caseNumber: '00012345',
    jiraKey: 'AABSP-42',
    jiraUrl: 'https://godaddy-corp.atlassian.net/browse/AABSP-42',
  };
  const result = buildBugReportBlocks(
    { topics: [], description: 'broken', followUp: true },
    'first-publish-banner',
    MIN_CTX,
    enrichment,
  );

  // Footer ordering (compact shape): [App ID label] → [Case, Jira] →
  // [diagnostic links] → [Details]. Triage links sit closest to the
  // App ID so the live CRM case + Jira issue for THIS submission are
  // the most prominent things after the id.
  assert.equal(result.links[0].text, 'app-1');
  assert.equal(result.links[0].url, undefined);
  assert.equal(result.links[1].text, 'Case #00012345');
  assert.equal(result.links[1].url, enrichment.crmCaseUrl);
  assert.equal(result.links[2].text, 'Jira');
  assert.equal(result.links[2].url, enrichment.jiraUrl);
  // Investigation NOT in Slack — investigator posts its own CRM note
  assert.equal(result.links.find(l => l.text === 'Investigation'), undefined);
  // Diagnostic links (Console) should still follow
  assert.ok(result.links.find(l => l.text === 'Console'));
});

await test('enrichment: Case label falls back to plain "Case" when caseNumber missing (resolver miss)', () => {
  const enrichment = {
    crmCaseUrl: 'https://godaddy2.lightning.force.com/lightning/r/Case/500U900000TUb7vIAD/view',
    // caseNumber omitted — async-path resolver timed out before SF persisted
  };
  const result = buildBugReportBlocks(
    { topics: [], description: 'broken', followUp: true },
    undefined,
    MIN_CTX,
    enrichment,
  );

  // [0] = App ID label; [1] = Case (resolver miss falls back to plain "Case").
  assert.equal(result.links[1].text, 'Case');
  assert.equal(result.links[1].url, enrichment.crmCaseUrl);
});

await test('enrichment: omitted entirely → no triage links, message identical to legacy shape', () => {
  const result = buildBugReportBlocks(
    { topics: [], description: 'broken', followUp: true },
    undefined,
    MIN_CTX,
  );
  // No Case/Jira links — backward compat with UI's legacy builder
  assert.equal(result.links.find(l => l.text === 'Case'), undefined);
  assert.equal(result.links.find(l => l.text === 'Jira'), undefined);
});

await test('enrichment: partial (Jira only, no CRM) → renders Jira only', () => {
  const enrichment = {
    jiraKey: 'AABSP-42',
    jiraUrl: 'https://godaddy-corp.atlassian.net/browse/AABSP-42',
  };
  const result = buildFeedbackBlocks(
    { topics: [], comment: 'meh', rating: 3, customerConsent: true },
    undefined,
    MIN_CTX,
    enrichment,
  );

  // [0] = App ID label; [1] = Jira (no Case in this enrichment).
  assert.equal(result.links[1].text, 'Jira');
  assert.equal(result.links.find(l => l.text === 'Case'), undefined);
});

await test('enrichment: support category gets triage links too', () => {
  const enrichment = {
    crmCaseUrl: 'https://godaddy2.lightning.force.com/lightning/r/Case/500U900000XYZ/view',
    caseNumber: '00099999',
    jiraKey: 'AABSP-9',
    jiraUrl: 'https://godaddy-corp.atlassian.net/browse/AABSP-9',
  };
  const result = buildSupportRequestBlocks(
    { topics: ['billing'], description: 'help', followUp: false },
    undefined,
    MIN_CTX,
    enrichment,
  );

  // [0] = App ID label; [1] = Case; [2] = Jira.
  assert.equal(result.links[1].text, 'Case #00099999');
  assert.equal(result.links[2].text, 'Jira');
});

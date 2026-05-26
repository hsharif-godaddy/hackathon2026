import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSupportRequestBlocks,
  buildBugReportBlocks,
  buildFeedbackBlocks,
} from './slack-builders.mjs';

/**
 * DITTO PARITY TESTS — assert exact JSON equivalence with what
 * `app/src/components/feedback/slackBuilders.ts` produces for the same
 * inputs. The expected shapes are hand-written from the UI source so
 * any drift in either side surfaces immediately.
 */

await test('buildSupportRequestBlocks: ditto UI format', () => {
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
  };

  const result = buildSupportRequestBlocks(data, origin, ctx);

  assert.deepEqual(result, {
    title: ':sos: Support Request',
    twoColumnSection: {
      leftFields: [
        { label: 'App ID', value: 'app-1' },
        { label: 'Subscription', value: 'Pro Annual / Active' },
        { label: 'Topics', value: 'ui, publish' },
        { label: 'Follow-up Consent', value: 'Yes' },
      ],
      rightFields: [
        { label: 'Origin', value: 'first-publish-banner' },
        { label: 'Experiments', value: 'exp1=A, exp2=B' },
      ],
    },
    singleColumnSections: [
      { label: 'Description', value: 'broken' },
      { value: '_We\'ll reply to the email on the customer\'s GoDaddy account._' },
    ],
    links: [
      { url: 'https://preview.airo-builder.test-godaddy.com/?airoShareToken=abc', text: 'Preview' },
      { url: 'https://example.com', text: 'Published' },
      { url: 'https://app.fullstory.com/some-session', text: 'FullStory' },
      { url: 'https://ctk.int.gdcorp.tools/nexus/results?criteria=app_id&term=app-1', text: 'Nexus' },
      { url: 'https://console.airo-builder.godaddy.com/?appId=app-1', text: 'Console' },
    ],
  });
});

await test('buildSupportRequestBlocks: empty rightFields → placeholder rightFields', () => {
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

  assert.deepEqual(result.twoColumnSection, {
    leftFields: [
      { label: 'App ID', value: 'app-only' },
      { label: 'Follow-up Consent', value: 'No' },
    ],
    rightFields: [{ value: ' ' }],
  });
  // Description omitted when blank, but the canned closing line always present
  assert.deepEqual(result.singleColumnSections, [
    { value: '_We\'ll reply to the email on the customer\'s GoDaddy account._' },
  ]);
});

await test('buildBugReportBlocks: ditto UI format', () => {
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
  };

  const result = buildBugReportBlocks(data, origin, ctx);

  assert.deepEqual(result, {
    title: ':bug: Bug Report',
    twoColumnSection: {
      leftFields: [
        { label: 'App ID', value: 'app-2' },
        { label: 'Issue Area', value: 'rendering' },
        { label: 'Follow-up Consent', value: 'No' },
      ],
      rightFields: [
        { label: 'Origin', value: 'develop-page' },
      ],
    },
    singleColumnSections: [
      { label: 'What Happened', value: 'crash on save' },
    ],
    links: [
      { url: 'https://preview.example/p?airoShareToken=t', text: 'Preview' },
      { url: 'https://fs/2', text: 'FullStory' },
      { url: 'https://ctk.int.gdcorp.tools/nexus/results?criteria=app_id&term=app-2', text: 'Nexus' },
      { url: 'https://console.airo-builder.godaddy.com/?appId=app-2', text: 'Console' },
    ],
  });
});

await test('buildBugReportBlocks: impersonating adds "Filed by" left field', () => {
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

  assert.deepEqual(result.twoColumnSection.leftFields, [
    { label: 'App ID', value: 'app-3' },
    { label: 'Filed by', value: 'CRM skip (99887)' },
    { label: 'Follow-up Consent', value: 'No' },
  ]);
  assert.deepEqual(result.twoColumnSection.rightFields, [{ value: ' ' }]);
});

await test('buildFeedbackBlocks: rating 7 → :star-struck: with Extremely positive label', () => {
  const data = { rating: 7, topics: ['ai'], comment: 'love it', customerConsent: true };
  const ctx = {
    currentAppId: 'app-f',
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: 'Free',
    isImpersonating: false,
    isInternalUser: false,
    shopperId: '12345',
  };

  const result = buildFeedbackBlocks(data, undefined, ctx);

  assert.deepEqual(result, {
    title: ':speech_balloon: Product Feedback',
    twoColumnSection: {
      leftFields: [
        { label: 'App ID', value: 'app-f' },
        { label: 'Subscription', value: 'Free' },
        { label: 'Customer Consent', value: 'Yes' },
      ],
      rightFields: [
        { value: '7/7 - Extremely positive\n:star-struck:' },
        { label: 'Topics', value: 'ai' },
      ],
    },
    singleColumnSections: [
      { label: 'Comment', value: 'love it' },
    ],
    links: [
      { url: 'https://ctk.int.gdcorp.tools/nexus/results?criteria=app_id&term=app-f', text: 'Nexus' },
      { url: 'https://console.airo-builder.godaddy.com/?appId=app-f', text: 'Console' },
    ],
  });
});

await test('buildFeedbackBlocks: impersonating session → "No score: E2S session"', () => {
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

  assert.deepEqual(result.twoColumnSection.rightFields, [
    { label: 'No score', value: 'E2S session' },
  ]);
  assert.deepEqual(result.twoColumnSection.leftFields, [
    { label: 'Customer Consent', value: 'No' },
  ]);
});

await test('buildFeedbackBlocks: internal user → "No score: TLA account (shopperId)"', () => {
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

  assert.deepEqual(result.twoColumnSection.rightFields, [
    { label: 'No score', value: 'TLA account (12345)' },
  ]);
});

await test('buildFeedbackBlocks: customer consent No', () => {
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
  assert.deepEqual(result.twoColumnSection.leftFields, [
    { label: 'Customer Consent', value: 'No' },
  ]);
  assert.deepEqual(result.twoColumnSection.rightFields, [
    { value: '4/7 - Neutral\n:neutral_face:' },
  ]);
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
  // Preview, Nexus, Console should still be present
  assert.equal(result.links.find(l => l.text === 'Preview').url, 'https://preview');
  assert.equal(
    result.links.find(l => l.text === 'Nexus').url,
    'https://ctk.int.gdcorp.tools/nexus/results?criteria=app_id&term=app-x',
  );
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

await test('enrichment: both triage links prepend the diagnostic links', () => {
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

  // Triage links should be the FIRST entries (prepended). Case label
  // includes the customer-facing caseNumber so triagers see the same
  // identifier the customer received in their CRM email; Jira keeps a
  // single-word label since the issue key is already in the URL hover.
  assert.equal(result.links[0].text, 'Case #00012345');
  assert.equal(result.links[0].url, enrichment.crmCaseUrl);
  assert.equal(result.links[1].text, 'Jira');
  assert.equal(result.links[1].url, enrichment.jiraUrl);
  // Investigation NOT in Slack — investigator posts its own CRM note
  assert.equal(result.links.find(l => l.text === 'Investigation'), undefined);
  // Diagnostic links (Nexus, Console) should still follow
  assert.ok(result.links.find(l => l.text === 'Nexus'));
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

  assert.equal(result.links[0].text, 'Case');
  assert.equal(result.links[0].url, enrichment.crmCaseUrl);
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

  assert.equal(result.links[0].text, 'Jira');
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

  assert.equal(result.links[0].text, 'Case #00099999');
  assert.equal(result.links[1].text, 'Jira');
});

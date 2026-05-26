import { describe, expect,it } from 'vitest';

import {
  buildBugReportBlocks,
  buildFeedbackBlocks,
  buildSupportRequestBlocks,
} from './slackBuilders';
import type { DiagnosticContext } from './types';

/**
 * Direct unit tests for the UI-side Slack builders. The UI is the canonical
 * source for the Block Kit shape; `fanout/slack-builders.mjs` is a verbatim
 * port. Feedback.test.tsx mocks this module out, so without these tests the
 * legacy UI Slack path (which still runs whenever appbuilder-fanout-via-lambda
 * is OFF) has no coverage. Mirrors the assertion style in
 * fanout/slack-builders.test.mjs so drift between the two surfaces fast.
 */

const FULL_CTX: DiagnosticContext = {
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

describe('buildSupportRequestBlocks', () => {
  it('compact shape: Description + canned reply, Subscription/Origin two-column, App-ID label + diagnostic + Details footer', () => {
    const data = { topics: ['ui', 'publish'], description: 'broken', followUp: true };
    const result = buildSupportRequestBlocks(data, 'first-publish-banner', FULL_CTX);

    expect(result).toEqual({
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
        { url: FULL_CTX.previewUrl!, text: 'Preview' },
        { url: FULL_CTX.publishedUrl!, text: 'Published' },
        { url: FULL_CTX.fullStoryUrl!, text: 'FS' },
        { url: 'https://console.airo-builder.godaddy.com/?appId=app-1', text: 'Console' },
        {
          url: 'https://console.airo-builder.godaddy.com/?customerId=cust-1&appId=app-1&tab=feedback&feedbackId=fb-uuid-s',
          text: 'Details',
        },
      ],
    });
  });

  it('blank description + no subscription/origin → undefined twoColumnSection, canned reply still present', () => {
    const data = { topics: [], description: '', followUp: false };
    const ctx: DiagnosticContext = {
      ...FULL_CTX,
      currentAppId: 'app-only',
      previewUrl: undefined,
      publishedUrl: undefined,
      fullStoryUrl: null,
      subscriptionInfo: '',
      experimentsLine: undefined,
      customerId: undefined,
      feedbackUuid: undefined,
    };
    const result = buildSupportRequestBlocks(data, undefined, ctx);

    expect(result.twoColumnSection).toBeUndefined();
    expect(result.singleColumnSections).toEqual([
      { value: '_We\'ll reply to the email on the customer\'s GoDaddy account._' },
    ]);
  });

  it('impersonating decorates the title with CRM-skip suffix', () => {
    const result = buildSupportRequestBlocks(
      { topics: [], description: 'oops', followUp: false },
      undefined,
      { ...FULL_CTX, isImpersonating: true },
    );
    expect(result.title).toBe(':sos: Support Request - :no_entry_sign: CRM skip (12345)');
  });
});

describe('buildBugReportBlocks', () => {
  it('compact shape: What Happened single-column, Subscription/Origin two-column, footer with App-ID + diagnostic + Details', () => {
    const data = { topics: ['ui'], description: 'crash', followUp: true };
    const result = buildBugReportBlocks(data, 'develop-page', FULL_CTX);

    expect(result.title).toBe(':bug: Bug Report');
    expect(result.singleColumnSections).toEqual([{ label: 'What Happened', value: 'crash' }]);
    expect(result.twoColumnSection).toEqual({
      leftFields: [{ label: 'Subscription', value: 'Pro Annual / Active' }],
      rightFields: [{ label: 'Origin', value: 'develop-page' }],
    });
    expect(result.links[0]).toEqual({ text: 'app-1' });
    expect(result.links.find((l) => l.text === 'Details')).toBeDefined();
    // No Topics, Follow-up Consent, Experiments fields in the body —
    // dropped from the compact digest, captured in the CRM case instead.
    const allLabels = (result.singleColumnSections ?? []).map((s) => s.label).filter(Boolean);
    expect(allLabels).not.toContain('Issue Area');
    expect(allLabels).not.toContain('Follow-up Consent');
    expect(allLabels).not.toContain('Experiments');
  });

  it('blank description → undefined singleColumnSections', () => {
    const result = buildBugReportBlocks(
      { topics: [], description: '   ', followUp: false },
      undefined,
      FULL_CTX,
    );
    expect(result.singleColumnSections).toBeUndefined();
  });

  it('impersonating decorates the title with CRM-skip suffix', () => {
    const result = buildBugReportBlocks(
      { topics: [], description: 'crash', followUp: false },
      undefined,
      { ...FULL_CTX, isImpersonating: true, shopperId: '99' },
    );
    expect(result.title).toBe(':bug: Bug Report - :no_entry_sign: CRM skip (99)');
  });
});

describe('buildFeedbackBlocks', () => {
  it('rating 7 → title carries score with star-struck emoji + comment in blockquote', () => {
    const data = {
      rating: 7,
      comment: 'love it',
      topics: [],
      customerConsent: true,
    };
    const result = buildFeedbackBlocks(data, 'first-publish-banner', FULL_CTX);

    expect(result.title).toBe(':speech_balloon: Product Feedback - 7/7 :star-struck:');
    expect(result.singleColumnSections).toEqual([{ value: '> love it' }]);
    expect(result.twoColumnSection).toEqual({
      leftFields: [{ label: 'Subscription', value: 'Pro Annual / Active' }],
      rightFields: [{ label: 'Origin', value: 'first-publish-banner' }],
    });
  });

  it('multiline comment is line-wise blockquoted', () => {
    const data = {
      rating: 4,
      comment: 'line one\nline two\nline three',
      topics: [],
      customerConsent: true,
    };
    const result = buildFeedbackBlocks(data, undefined, FULL_CTX);
    expect(result.singleColumnSections).toEqual([
      { value: '> line one\n> line two\n> line three' },
    ]);
  });

  it('rating 4 + empty comment → title only, no body sections', () => {
    const data = { rating: 4, comment: '', topics: [], customerConsent: false };
    const result = buildFeedbackBlocks(data, undefined, {
      ...FULL_CTX,
      subscriptionInfo: '',
    });
    expect(result.title).toBe(':speech_balloon: Product Feedback - 4/7 :neutral_face:');
    expect(result.singleColumnSections).toBeUndefined();
  });

  it('impersonating session → No score in title', () => {
    const result = buildFeedbackBlocks(
      { rating: 7, comment: 'cool', topics: [], customerConsent: true },
      undefined,
      { ...FULL_CTX, isImpersonating: true },
    );
    expect(result.title).toBe(':speech_balloon: Product Feedback - :no_entry_sign: No score (E2S session)');
  });

  it('internal user → No score (TLA account) in title', () => {
    const result = buildFeedbackBlocks(
      { rating: 5, comment: 'fine', topics: [], customerConsent: true },
      undefined,
      { ...FULL_CTX, isInternalUser: true, shopperId: 'abc' },
    );
    expect(result.title).toBe(':speech_balloon: Product Feedback - :no_entry_sign: No score (TLA account (abc))');
  });

  it('Details link omits feedbackId / customerId when missing', () => {
    const result = buildFeedbackBlocks(
      { rating: 6, comment: 'ok', topics: [], customerConsent: true },
      undefined,
      { ...FULL_CTX, customerId: undefined, feedbackUuid: undefined },
    );
    const details = result.links.find((l) => l.text === 'Details');
    expect(details).toEqual({
      url: 'https://console.airo-builder.godaddy.com/?appId=app-1&tab=feedback',
      text: 'Details',
    });
  });
});

describe('buildDiagnosticLinks (via builders)', () => {
  it('publishedUrl containing "test-" is omitted', () => {
    const ctx: DiagnosticContext = {
      ...FULL_CTX,
      publishedUrl: 'https://test-site.example.com',
    };
    const result = buildBugReportBlocks(
      { topics: [], description: 'x', followUp: false },
      undefined,
      ctx,
    );
    expect(result.links.find((l) => l.text === 'Published')).toBeUndefined();
    // Other links unaffected
    expect(result.links.find((l) => l.text === 'Preview')).toBeDefined();
  });
});

/**
 * Slack Block Kit message builders for feedback submissions.
 *
 * VERBATIM PORT of `app/src/components/feedback/slackBuilders.ts`.
 * The UI source is the canonical version; this module exists only so the
 * fanout Lambda can rebuild the same Block Kit message from a parquet row.
 *
 * If you change either side, change BOTH and the ditto-parity tests in
 * slack-builders.test.mjs / Feedback.test.tsx will catch drift.
 */

const RATING_EMOJIS = {
  '1': ':alert_red: :alert_red: :alert_red:',
  '2': ':alert_orange: :alert_orange:',
  '3': ':alert_yellow:',
  '4': ':neutral_face:',
  '5': ':slightly_smiling_face:',
  '6': ':smile:',
  '7': ':star-struck:',
};

const RATING_LABELS = {
  '1': 'Very negative',
  '2': 'Negative',
  '3': 'Somewhat negative',
  '4': 'Neutral',
  '5': 'Positive',
  '6': 'Very positive',
  '7': 'Extremely positive',
};

function buildDiagnosticLinks(ctx) {
  const links = [];

  if (ctx.previewUrl) {
    links.push({ url: ctx.previewUrl, text: 'Preview' });
  }
  if (ctx.publishedUrl && !ctx.publishedUrl.includes('test-')) {
    links.push({ url: ctx.publishedUrl, text: 'Published' });
  }
  if (ctx.fullStoryUrl) {
    links.push({ url: ctx.fullStoryUrl, text: 'FullStory' });
  }
  if (ctx.currentAppId) {
    links.push({
      url: `https://ctk.int.gdcorp.tools/nexus/results?criteria=app_id&term=${ctx.currentAppId}`,
      text: 'Nexus',
    });
    links.push({
      url: `https://console.airo-builder.godaddy.com/?appId=${ctx.currentAppId}`,
      text: 'Console',
    });
  }

  return links;
}

function buildCustomerInfoLeft(ctx) {
  const fields = [];

  if (ctx.currentAppId) {
    fields.push({ label: 'App ID', value: ctx.currentAppId });
  }
  if (ctx.subscriptionInfo) {
    fields.push({ label: 'Subscription', value: ctx.subscriptionInfo });
  }

  return fields;
}

export function buildSupportRequestBlocks(data, origin, ctx) {
  const leftFields = buildCustomerInfoLeft(ctx);
  const rightFields = [];

  if (data.topics.length > 0) {
    leftFields.push({ label: 'Topics', value: data.topics.join(', ') });
  }
  leftFields.push({ label: 'Follow-up Consent', value: data.followUp ? 'Yes' : 'No' });

  if (origin) {
    rightFields.push({ label: 'Origin', value: origin });
  }
  if (ctx.experimentsLine) {
    rightFields.push({ label: 'Experiments', value: ctx.experimentsLine });
  }

  const singleColumnSections = [];
  if (data.description.trim()) {
    singleColumnSections.push({ label: 'Description', value: data.description.trim() });
  }
  singleColumnSections.push({
    value: '_We\'ll reply to the email on the customer\'s GoDaddy account._',
  });

  return {
    title: ':sos: Support Request',
    twoColumnSection: leftFields.length > 0 && rightFields.length > 0
      ? { leftFields, rightFields }
      : leftFields.length > 0
        ? { leftFields, rightFields: [{ value: ' ' }] }
        : undefined,
    singleColumnSections,
    links: buildDiagnosticLinks(ctx),
  };
}

export function buildBugReportBlocks(data, origin, ctx) {
  const leftFields = buildCustomerInfoLeft(ctx);
  const rightFields = [];

  if (ctx.isImpersonating) {
    leftFields.push({ label: 'Filed by', value: `CRM skip (${ctx.shopperId || 'unknown'})` });
  }
  if (data.topics.length > 0) {
    leftFields.push({ label: 'Issue Area', value: data.topics.join(', ') });
  }
  leftFields.push({ label: 'Follow-up Consent', value: data.followUp ? 'Yes' : 'No' });

  if (origin) {
    rightFields.push({ label: 'Origin', value: origin });
  }
  if (ctx.experimentsLine) {
    rightFields.push({ label: 'Experiments', value: ctx.experimentsLine });
  }

  const singleColumnSections = [];
  if (data.description.trim()) {
    singleColumnSections.push({ label: 'What Happened', value: data.description.trim() });
  }

  return {
    title: ':bug: Bug Report',
    twoColumnSection: leftFields.length > 0 && rightFields.length > 0
      ? { leftFields, rightFields }
      : leftFields.length > 0
        ? { leftFields, rightFields: [{ value: ' ' }] }
        : undefined,
    singleColumnSections: singleColumnSections.length > 0 ? singleColumnSections : undefined,
    links: buildDiagnosticLinks(ctx),
  };
}

export function buildFeedbackBlocks(data, origin, ctx) {
  const leftFields = buildCustomerInfoLeft(ctx);
  const rightFields = [];

  // Customer consent
  leftFields.push({
    label: 'Customer Consent',
    value: data.customerConsent ? 'Yes' : 'No',
  });

  // Rating display
  if (ctx.isImpersonating || ctx.isInternalUser) {
    rightFields.push({
      label: 'No score',
      value: ctx.isImpersonating ? 'E2S session' : `TLA account (${ctx.shopperId || 'unknown'})`,
    });
  } else if (data.rating) {
    const ratingStr = String(data.rating);
    const emoji = RATING_EMOJIS[ratingStr] || ':question:';
    const label = RATING_LABELS[ratingStr] || 'Unknown';
    rightFields.push({
      value: `${ratingStr}/7 - ${label}\n${emoji}`,
    });
  }

  if (origin) {
    rightFields.push({ label: 'Origin', value: origin });
  }

  if (data.topics.length > 0) {
    rightFields.push({ label: 'Topics', value: data.topics.join(', ') });
  }

  if (ctx.experimentsLine) {
    rightFields.push({ label: 'Experiments', value: ctx.experimentsLine });
  }

  const singleColumnSections = [];
  if (data.comment && data.comment.trim()) {
    singleColumnSections.push({ label: 'Comment', value: data.comment.trim() });
  }

  return {
    title: ':speech_balloon: Product Feedback',
    twoColumnSection: leftFields.length > 0 && rightFields.length > 0
      ? { leftFields, rightFields }
      : undefined,
    singleColumnSections: singleColumnSections.length > 0 ? singleColumnSections : undefined,
    links: buildDiagnosticLinks(ctx),
  };
}

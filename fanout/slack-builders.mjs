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
  '1': ':alert_red:',
  '2': ':alert_orange:',
  '3': ':alert_yellow:',
  '4': ':neutral_face:',
  '5': ':slightly_smiling_face:',
  '6': ':smile:',
  '7': ':star-struck:',
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
    links.push({ url: ctx.fullStoryUrl, text: 'FS' });
  }
  if (ctx.currentAppId) {
    links.push({
      url: `https://console.airo-builder.godaddy.com/?appId=${ctx.currentAppId}`,
      text: 'Console',
    });
  }

  return links;
}

/**
 * Triage-link section: CRM case in Salesforce + AABSP Jira issue. Each
 * link rendered only when its entity exists. Returns an array of
 * {url, text} entries appended to footer links between App ID label and
 * diagnostic links so triagers see the live case/issue right next to the app id.
 *
 * Investigation URL deliberately omitted — the investigator already
 * posts its own deep-link as a CRM case note when it completes (see
 * `maybeAddCrmCaseNote` in `investigator/handler.mjs`), and the kickoff
 * note posts the same link upfront. Slack would be a third copy with
 * no triage value-add.
 *
 * Lambda-only: the UI's slackBuilders.ts doesn't have this helper
 * because the UI builds Slack messages BEFORE these downstreams run.
 * Lambda has the IDs in hand at message-build time, so it can deep-link.
 */
function buildTriageLinks(enrichment) {
  if (!enrichment) return [];
  const links = [];
  if (enrichment.crmCaseUrl) {
    // Show `Case #<caseNumber>` when the resolver materialized the
    // customer-facing number (matches what the customer sees in their
    // CRM email — "Your ticket ID is: 00012345"). On async-path
    // resolver miss caseNumber is null and we render plain `Case` so
    // the link still surfaces; the caseRecordId in the URL is enough
    // for triagers to deep-link into Salesforce Lightning.
    const text = enrichment.caseNumber ? `Case #${enrichment.caseNumber}` : 'Case';
    links.push({ url: enrichment.crmCaseUrl, text });
  }
  if (enrichment.jiraUrl) {
    links.push({ url: enrichment.jiraUrl, text: 'Jira' });
  }
  return links;
}

function buildSubscriptionOriginSection(ctx, origin) {
  const leftFields = [];
  if (ctx.subscriptionInfo) {
    leftFields.push({ label: 'Subscription', value: ctx.subscriptionInfo });
  }
  const rightFields = [];
  if (origin) {
    rightFields.push({ label: 'Origin', value: origin });
  }
  if (leftFields.length > 0 && rightFields.length > 0) return { leftFields, rightFields };
  if (leftFields.length > 0) return { leftFields, rightFields: [{ value: ' ' }] };
  if (rightFields.length > 0) return { leftFields: [{ label: ' ', value: ' ' }], rightFields };
  return undefined;
}

function decorateTitleForImpersonation(baseTitle, ctx) {
  if (!ctx.isImpersonating) return baseTitle;
  return `${baseTitle} - :no_entry_sign: CRM skip (${ctx.shopperId || 'unknown'})`;
}

// Deep-links every Slack message (feedback / issue / support) to the
// debug-console Feedback tab — the panel renders all three categories
// keyed by appId, and `feedbackId` (when available, Lambda-path only)
// auto-expands the matching row.
function buildDetailsLink(ctx) {
  if (!ctx.currentAppId) return null;
  const params = [`appId=${ctx.currentAppId}`, 'tab=feedback'];
  if (ctx.customerId) params.unshift(`customerId=${ctx.customerId}`);
  if (ctx.feedbackUuid) params.push(`feedbackId=${ctx.feedbackUuid}`);
  return {
    url: `https://console.airo-builder.godaddy.com/?${params.join('&')}`,
    text: 'Details',
  };
}

// Footer ordering: [App ID copy-label] → [triage links: Case, Jira] →
// [diagnostic links: Preview, Published, FS, Console] → [Details].
// Triage links sit closest to the App ID so the CRM case + Jira issue
// for THIS submission are the most prominent things after the id.
// Diagnostic links (env state) follow. Details (debug-console) closes
// out the row.
function buildFooterLinks(ctx, enrichment) {
  const links = [];
  // App ID as a plain-text label so triagers can copy the id without
  // scrolling — rendered ahead of the click-through links.
  if (ctx.currentAppId) {
    links.push({ text: ctx.currentAppId });
  }
  links.push(...buildTriageLinks(enrichment));
  links.push(...buildDiagnosticLinks(ctx));
  const detailsLink = buildDetailsLink(ctx);
  if (detailsLink) links.push(detailsLink);
  return links;
}

function quoteBlock(text) {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

export function buildSupportRequestBlocks(data, origin, ctx, enrichment = null) {
  // Compact shape — matches the Feedback redesign. Body is the
  // description + canned reply line + Subscription/Origin two-column.
  // Topics, Follow-up Consent, Experiments, App ID drop from the digest
  // (still captured in the CRM case for triage). Title carries the
  // CRM-skip suffix when impersonating so it surfaces in push notifications.
  const singleColumnSections = [];
  if (data.description.trim()) {
    singleColumnSections.push({ label: 'Description', value: data.description.trim() });
  }
  singleColumnSections.push({
    value: '_We\'ll reply to the email on the customer\'s GoDaddy account._',
  });

  return {
    title: decorateTitleForImpersonation(':sos: Support Request', ctx),
    singleColumnSections,
    twoColumnSection: buildSubscriptionOriginSection(ctx, origin),
    links: buildFooterLinks(ctx, enrichment),
  };
}

export function buildBugReportBlocks(data, origin, ctx, enrichment = null) {
  // Compact shape — matches the Feedback redesign. Body is the
  // description + Subscription/Origin two-column. Issue Area,
  // Follow-up Consent, Experiments, App ID drop from the digest (still
  // captured in the CRM case). Title carries the CRM-skip suffix when
  // impersonating so it surfaces in push notifications.
  const singleColumnSections = [];
  if (data.description.trim()) {
    singleColumnSections.push({ label: 'What Happened', value: data.description.trim() });
  }

  return {
    title: decorateTitleForImpersonation(':bug: Bug Report', ctx),
    singleColumnSections: singleColumnSections.length > 0 ? singleColumnSections : undefined,
    twoColumnSection: buildSubscriptionOriginSection(ctx, origin),
    links: buildFooterLinks(ctx, enrichment),
  };
}

export function buildFeedbackBlocks(data, origin, ctx, enrichment = null) {
  // Title carries the rating so it shows in Slack push notifications
  // (also used as the fallback `text` field). Body keeps Subscription +
  // Origin (the two facts readers triage on most often) and the comment.
  // Everything else (consent, topics, experiments, customer profile) is
  // one click away in the debug-console feedback tab via the Details link.
  let title = ':speech_balloon: Product Feedback';
  if (ctx.isImpersonating || ctx.isInternalUser) {
    const reason = ctx.isImpersonating
      ? 'E2S session'
      : `TLA account (${ctx.shopperId || 'unknown'})`;
    title = `${title} - :no_entry_sign: No score (${reason})`;
  } else if (data.rating) {
    const ratingStr = String(data.rating);
    const emoji = RATING_EMOJIS[ratingStr] || ':question:';
    title = `${title} - ${ratingStr}/7 ${emoji}`;
  }

  const singleColumnSections = [];
  const trimmedComment = data.comment ? data.comment.trim() : '';
  if (trimmedComment) {
    singleColumnSections.push({ value: quoteBlock(trimmedComment) });
  }

  return {
    title,
    twoColumnSection: buildSubscriptionOriginSection(ctx, origin),
    singleColumnSections: singleColumnSections.length > 0 ? singleColumnSections : undefined,
    links: buildFooterLinks(ctx, enrichment),
  };
}

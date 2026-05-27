import type { SlackBlockMessage, SlackLink, SlackSingleSection } from '@/lib/slack-webhook';
import type { DiagnosticContext, IssueFormData, ShareFeedbackFormData, SupportFormData } from './types';

const RATING_EMOJIS: Record<string, string> = {
  '1': ':red_circle:',
  '2': ':large_orange_circle:',
  '3': ':large_yellow_circle:',
  '4': ':neutral_face:',
  '5': ':slightly_smiling_face:',
  '6': ':smile:',
  '7': ':star-struck:',
};

function buildDiagnosticLinks(ctx: DiagnosticContext): SlackLink[] {
  const links: SlackLink[] = [];

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

// Deep-links every Slack message (feedback / issue / support) to the
// debug-console Feedback tab — the panel renders all three categories
// keyed by appId, and `feedbackId` (when available, Lambda-path only)
// auto-expands the matching row.
function buildDetailsLink(ctx: DiagnosticContext): SlackLink | null {
  if (!ctx.currentAppId) return null;
  const params = [`appId=${ctx.currentAppId}`, 'tab=feedback'];
  if (ctx.customerId) params.unshift(`customerId=${ctx.customerId}`);
  if (ctx.feedbackUuid) params.push(`feedbackId=${ctx.feedbackUuid}`);
  return {
    url: `https://console.airo-builder.godaddy.com/?${params.join('&')}`,
    text: 'Details',
  };
}

function buildFooterLinks(ctx: DiagnosticContext): SlackLink[] {
  const links: SlackLink[] = [];
  // App ID as a plain-text label so triagers can copy the id without
  // scrolling — rendered ahead of the click-through links.
  if (ctx.currentAppId) {
    links.push({ text: ctx.currentAppId });
  }
  links.push(...buildDiagnosticLinks(ctx));
  const detailsLink = buildDetailsLink(ctx);
  if (detailsLink) links.push(detailsLink);
  return links;
}

function quoteBlock(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

function buildSubscriptionOriginSection(
  ctx: DiagnosticContext,
  origin: string | undefined,
): SlackBlockMessage['twoColumnSection'] {
  const leftFields: Array<{ label: string; value: string }> = [];
  if (ctx.subscriptionInfo) {
    leftFields.push({ label: 'Subscription', value: ctx.subscriptionInfo });
  }
  const rightFields: Array<{ label?: string; value: string }> = [];
  if (origin) {
    rightFields.push({ label: 'Origin', value: origin });
  }
  if (leftFields.length > 0 && rightFields.length > 0) return { leftFields, rightFields };
  if (leftFields.length > 0) return { leftFields, rightFields: [{ value: ' ' }] };
  if (rightFields.length > 0) return { leftFields: [{ label: ' ', value: ' ' }], rightFields };
  return undefined;
}

function decorateTitleForImpersonation(baseTitle: string, ctx: DiagnosticContext): string {
  if (!ctx.isImpersonating) return baseTitle;
  return `${baseTitle} - :no_entry_sign: CRM skip (${ctx.shopperId || 'unknown'})`;
}

export function buildSupportRequestBlocks(
  data: SupportFormData,
  origin: string | undefined,
  ctx: DiagnosticContext,
): SlackBlockMessage {
  // Compact shape — matches the Feedback redesign. Body is the
  // description + canned reply line + Subscription/Origin two-column.
  // Topics, Follow-up Consent, Experiments, App ID drop from the digest
  // (still captured in the CRM case for triage). Title carries the
  // CRM-skip suffix when impersonating so it surfaces in push notifications.
  const singleColumnSections: SlackSingleSection[] = [];
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
    links: buildFooterLinks(ctx),
  };
}

export function buildBugReportBlocks(
  data: IssueFormData,
  origin: string | undefined,
  ctx: DiagnosticContext,
): SlackBlockMessage {
  // Compact shape — matches the Feedback redesign. Body is the
  // description + Subscription/Origin two-column. Issue Area,
  // Follow-up Consent, Experiments, App ID drop from the digest (still
  // captured in the CRM case). Title carries the CRM-skip suffix when
  // impersonating so it surfaces in push notifications.
  const singleColumnSections: SlackSingleSection[] = [];
  if (data.description.trim()) {
    singleColumnSections.push({ label: 'What Happened', value: data.description.trim() });
  }

  return {
    title: decorateTitleForImpersonation(':bug: Bug Report', ctx),
    singleColumnSections: singleColumnSections.length > 0 ? singleColumnSections : undefined,
    twoColumnSection: buildSubscriptionOriginSection(ctx, origin),
    links: buildFooterLinks(ctx),
  };
}

export function buildFeedbackBlocks(
  data: ShareFeedbackFormData,
  origin: string | undefined,
  ctx: DiagnosticContext,
): SlackBlockMessage {
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

  const singleColumnSections: SlackSingleSection[] = [];
  const trimmedComment = data.comment ? data.comment.trim() : '';
  if (trimmedComment) {
    singleColumnSections.push({ value: quoteBlock(trimmedComment) });
  }

  return {
    title,
    twoColumnSection: buildSubscriptionOriginSection(ctx, origin),
    singleColumnSections: singleColumnSections.length > 0 ? singleColumnSections : undefined,
    links: buildFooterLinks(ctx),
  };
}

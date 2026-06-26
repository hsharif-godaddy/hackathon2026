import {
  generateDecoratedCampaignUrl,
  type CampaignResourceType,
  type DecoratedUrlResult,
  type UtmWriter,
} from './utm-url-generator.js';

/**
 * Campaign CTA link decoration (RUBICON-501).
 *
 * Applies the RUBICON-499 decorated URL to the ONE link that matters — the campaign
 * conversion CTA pointing at `/lp/<slug>` — and leaves every other link bare.
 *
 * The attribution model disambiguates by link *purpose*, not domain. The blog and the
 * landing page sit on the SAME customer domain, so a naive "same-domain → skip" rule would
 * wrongly strip the conversion CTA. The rule here is the inverse: a link whose target is the
 * campaign landing page is the conversion CTA and IS decorated (full cmp_/act_ token set);
 * incidental same-domain links (in-blog nav, footer, profile, other pages) stay undecorated.
 */

/** Resolve the path of a link, whether it is relative (`/lp/x`) or absolute (`https://…/lp/x`). */
function extractPath(href: string): string | null {
  const trimmed: string = href.trim();
  if (trimmed === '') {
    return null;
  }
  try {
    // The base is only used to resolve relative hrefs; the resulting host is ignored.
    return new URL(trimmed, 'https://campaign-link.local').pathname.replace(/\/+$/, '') || '/';
  } catch {
    return null;
  }
}

/**
 * True when href's PATH is the campaign conversion landing page (`/lp/<slug>`). This is a
 * path-based classifier (origin-agnostic): for a cross-origin link a caller that cares about
 * domain must also compare origins — here a protocol-relative/absolute href that merely
 * shares the path will match, which is fine for the in-content decoration flow below.
 */
export function isCampaignConversionCta(href: string, campaignSlug: string): boolean {
  const path: string | null = extractPath(href);
  if (path === null) {
    return false;
  }
  return path === `/lp/${campaignSlug}`;
}

/**
 * Decorate the campaign conversion CTA(s) inside authored content (social body or blog
 * markdown), leaving incidental links untouched. Matches the conversion CTA as a WHOLE link
 * token — relative (`/lp/<slug>`) or absolute (`https://host/lp/<slug>`) — preceded by a link
 * boundary (start, whitespace, `(`, quote, `=`) and replaces the entire token with
 * decoratedHref. Replacing the whole token (not just the path substring) means an absolute
 * occurrence is swapped wholesale, so we never produce `https://hosthttps://host/...` when
 * decoratedHref is itself absolute. Skips links already carrying a query (`?…`, no
 * double-decoration), a deeper path segment, or a prefix-sharing slug (`/lp/<slug>-2023`).
 * Protocol-relative cross-domain links (`//other.com/lp/<slug>`) are intentionally NOT matched.
 */
// Literal (constant) pattern — no slug interpolation, so there is no dynamic-RegExp / ReDoS
// surface. It captures the boundary char and the actual `/lp/<slug>` slug segment; the
// replacer below decorates only when the captured slug exactly equals the campaign's.
const CONVERSION_CTA_PATTERN: RegExp =
  /(^|[\s("'=])(?:https?:\/\/[^\s)"'<>]*?)?\/lp\/([A-Za-z0-9_-]+)\/?(?![\w?#=&/-])/g;

export function decorateConversionCtaLinks(text: string, campaignSlug: string, decoratedHref: string): string {
  return text.replace(CONVERSION_CTA_PATTERN, (match: string, boundary: string, slug: string): string =>
    slug === campaignSlug ? `${boundary}${decoratedHref}` : match,
  );
}

export interface DecorateCtaParams {
  publishedUrl: string;
  campaignSlug: string;
  contentRefId: string;
  simpleCampaignId: string;
  topicSlug?: string;
  utmWriter?: UtmWriter;
}

/**
 * Decorate a blog post's conversion CTA: mints the marketing_utm row and returns the
 * RELATIVE decorated path (`/lp/<slug>?utm_…`) to bake into the markdown — same-origin, so a
 * relative link survives a domain change.
 */
export function decorateBlogCta(params: DecorateCtaParams): DecoratedUrlResult {
  return generateDecoratedCampaignUrl({ ...params, resourceType: 'blog' as CampaignResourceType });
}

export interface DecorateSocialCtaParams extends DecorateCtaParams {
  /** facebook | instagram — selects the utm_source. */
  platform: string;
}

/**
 * Decorate a social post's conversion CTA: mints the marketing_utm row and returns the
 * ABSOLUTE decorated URL to write into the post body (the published domain is known because
 * a published website is a prerequisite for creating a campaign).
 */
export function decorateSocialCta(params: DecorateSocialCtaParams): DecoratedUrlResult {
  return generateDecoratedCampaignUrl({ ...params, resourceType: 'social' as CampaignResourceType });
}

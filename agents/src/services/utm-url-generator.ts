import { UtmMedium, UtmSource } from '../database/schema.js';
import type { UTMAttributionParams } from '../database/schema.js';
import { MarketingUtmRepository } from '../database/repositories/MarketingUtmRepository.js';
import type { CreateUTMAttributionParams } from '../database/repositories/MarketingUtmRepository.js';
import { Logger } from '../logging/index.js';

/**
 * UTM decorated-URL generation service (RUBICON-499).
 *
 * Turns a campaign + a piece of content into a fully UTM-decorated, customer-facing
 * destination URL pointing at the campaign landing page (`/lp/<slug>`), and persists the
 * mapping to `marketing_utm` so the click is attributable to campaign + channel + creative.
 *
 * The opaque `cmp_`/`act_` tokens come from the repository (RUBICON-500), so the URL is
 * built from the persisted row — the emitted URL and the stored row always carry identical
 * values. Source/medium are selected from the closed `UtmSource`/`UtmMedium` enums via a
 * lookup (not hardcoded branches), so M2 channels (email, ads) are an additive entry.
 */

const logger = Logger.create({ component: 'utm-url-generator' });

/** M1 campaign content carriers. Email/ads are deferred to M2. */
export type CampaignResourceType = 'social' | 'blog';

/** utm_term default — NEVER blank per the attribution model. */
export const UTM_TERM_NONE: string = 'none';

interface UtmChannel {
  utmSource: UtmSource;
  utmMedium: UtmMedium;
}

// Closed social-platform → utm_source map (M1: facebook, instagram, google_business_profile).
// Keys are the lowercased SocialPlatform values, so a caller may pass either the enum value
// (e.g. 'GOOGLE_BUSINESS_PROFILE') or its lowercase form. All map to the organic_social medium.
const SOCIAL_SOURCE_BY_PLATFORM: Readonly<Record<string, UtmSource>> = {
  facebook: UtmSource.Facebook,
  instagram: UtmSource.Instagram,
  google_business_profile: UtmSource.GoogleBusinessProfile,
};

/**
 * Select the closed-vocab (utm_source, utm_medium) for a resource. Blog is fixed; social
 * resolves utm_source from the platform. Lookup-based so adding an M2 channel is a new
 * entry, not a new branch.
 */
function resolveChannel(resourceType: CampaignResourceType, platform?: string): UtmChannel {
  if (resourceType === 'blog') {
    return { utmSource: UtmSource.BlogAab, utmMedium: UtmMedium.Blog };
  }
  const key: string = (platform ?? '').toLowerCase();
  const utmSource: UtmSource | undefined = SOCIAL_SOURCE_BY_PLATFORM[key];
  if (!utmSource) {
    throw new Error(`Unsupported social platform for UTM generation: ${platform ?? '(none)'}`);
  }
  return { utmSource, utmMedium: UtmMedium.OrganicSocial };
}

/** Lowercase, hyphenate, strip non-url-safe chars — keeps utm_term values clean. */
function slugifyTopic(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Build utm_term: `topic_<slug>` when a topic is present, else the literal `none`. */
export function buildUtmTerm(topicSlug?: string): string {
  const slug: string = slugifyTopic((topicSlug ?? '').trim());
  return slug.length > 0 ? `topic_${slug}` : UTM_TERM_NONE;
}

/**
 * Validate and parse the campaign base URL. The base MUST be the published customer-facing
 * site URL — preview / builder / internal / localhost URLs are rejected (a published
 * website is a prerequisite for a campaign).
 */
export function assertPublishedBaseUrl(publishedUrl: string | null | undefined): URL {
  if (!publishedUrl || publishedUrl.trim() === '') {
    throw new Error('A published website is required to generate campaign URLs (publishedUrl is empty).');
  }
  let parsed: URL;
  try {
    parsed = new URL(publishedUrl);
  } catch {
    throw new Error(`Invalid published URL: ${publishedUrl}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Published URL must be http(s): ${publishedUrl}`);
  }
  const host: string = parsed.hostname.toLowerCase();
  // Match `preview` as a host LABEL (preview.foo.com, app.preview.foo.com), not a
  // substring — a real published domain like `previewstudio.com` must not be rejected.
  // The caller already passes the published (not preview) URL from getSiteData; this is
  // defense-in-depth. TODO(publish-team): confirm the canonical AAB preview-host pattern.
  const labels: string[] = host.split('.');
  const isInternal: boolean =
    host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || labels.includes('preview');
  if (isInternal) {
    throw new Error(`Refusing preview/builder/internal URL as campaign base: ${publishedUrl}`);
  }
  return parsed;
}

interface UtmQueryFields {
  utmSource: UtmSource | string | null;
  utmMedium: UtmMedium | string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}

/** Assemble the utm_* query string in the canonical source→medium→campaign→content→term order. */
function buildUtmSearchParams(utm: UtmQueryFields): URLSearchParams {
  const params: URLSearchParams = new URLSearchParams();
  if (utm.utmSource) {
    params.set('utm_source', String(utm.utmSource));
  }
  if (utm.utmMedium) {
    params.set('utm_medium', String(utm.utmMedium));
  }
  if (utm.utmCampaign) {
    params.set('utm_campaign', utm.utmCampaign);
  }
  if (utm.utmContent) {
    params.set('utm_content', utm.utmContent);
  }
  if (utm.utmTerm) {
    params.set('utm_term', utm.utmTerm);
  }
  return params;
}

/** Build the relative decorated landing path: `/lp/<slug>?utm_...`. */
export function buildLandingPath(campaignSlug: string, utm: UtmQueryFields): string {
  return `/lp/${campaignSlug}?${buildUtmSearchParams(utm).toString()}`;
}

/** Minimal writer surface — lets tests inject a fake without a real database. */
export interface UtmWriter {
  create(params: CreateUTMAttributionParams): UTMAttributionParams;
}

export interface GenerateDecoratedUrlParams {
  /** Published customer-facing site base URL (from getSiteData). Validated. */
  publishedUrl: string;
  /** Sanitized campaign slug (the frozen `/lp/<slug>` value from the approved plan). */
  campaignSlug: string;
  resourceType: CampaignResourceType;
  /** Target content row id — social_posts.id for social, posts.json entry id for blog. */
  contentRefId: string;
  simpleCampaignId: string;
  /**
   * Required for social — a SINGLE concrete platform (`facebook` | `instagram` |
   * `google_business_profile`), NOT `all`. The caller must fan out per platform (one
   * decorated URL + marketing_utm row per platform/carrier); an unknown/`all` value is
   * rejected. Ignored for blog.
   */
  platform?: string;
  /** Topic for utm_term; defaults to `none` when absent. */
  topicSlug?: string;
  /** Injectable for tests; defaults to a real MarketingUtmRepository. */
  utmWriter?: UtmWriter;
}

export interface DecoratedUrlResult {
  /** Absolute decorated URL (`https://site/lp/slug?utm_...`) — used by social. */
  absoluteUrl: string;
  /** Relative decorated path (`/lp/slug?utm_...`) — used by blog (same-origin). */
  relativePath: string;
  /** The persisted marketing_utm row (carries the cmp_/act_ tokens). */
  utm: UTMAttributionParams;
}

/**
 * Generate the decorated destination URL for one campaign content carrier and persist the
 * marketing_utm mapping (one token per carrier). Returns both the absolute URL (social) and
 * the relative path (blog) built from the persisted row, so callers pick the right form.
 */
export function generateDecoratedCampaignUrl(params: GenerateDecoratedUrlParams): DecoratedUrlResult {
  if (!params.campaignSlug || params.campaignSlug.trim() === '') {
    throw new Error('campaignSlug is required to build the decorated landing URL.');
  }
  const base: URL = assertPublishedBaseUrl(params.publishedUrl);
  const channel: UtmChannel = resolveChannel(params.resourceType, params.platform);
  const utmTerm: string = buildUtmTerm(params.topicSlug);
  const writer: UtmWriter = params.utmWriter ?? new MarketingUtmRepository();

  const utm: UTMAttributionParams = writer.create({
    contentRefId: params.contentRefId,
    simpleCampaignId: params.simpleCampaignId,
    utmSource: channel.utmSource,
    utmMedium: channel.utmMedium,
    utmTerm,
  });

  const relativePath: string = buildLandingPath(params.campaignSlug, utm);
  const absoluteUrl: string = new URL(relativePath, base).toString();

  logger.info('utm.url.generated', {
    simpleCampaignId: params.simpleCampaignId,
    contentRefId: params.contentRefId,
    resourceType: params.resourceType,
    utmId: utm.id,
  });

  return { absoluteUrl, relativePath, utm };
}

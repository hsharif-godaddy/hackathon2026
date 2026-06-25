import { describe, it, expect } from 'vitest';
import { UtmMedium, UtmSource } from '../../database/schema.js';
import type { UTMAttributionParams } from '../../database/schema.js';
import type { CreateUTMAttributionParams } from '../../database/repositories/MarketingUtmRepository.js';
import {
  assertPublishedBaseUrl,
  buildLandingPath,
  buildUtmTerm,
  generateDecoratedCampaignUrl,
  UTM_TERM_NONE,
  type UtmWriter,
  type DecoratedUrlResult,
} from '../utm-url-generator.js';

// Captures the params and returns a canned row with deterministic cmp_/act_ tokens, so the
// URL-assembly + channel-selection logic is testable without a database or the signer.
class FakeUtmWriter implements UtmWriter {
  public lastParams: CreateUTMAttributionParams | undefined;

  create(params: CreateUTMAttributionParams): UTMAttributionParams {
    this.lastParams = params;
    return {
      id: 'mutm_test',
      contentRefId: params.contentRefId,
      simpleCampaignId: params.simpleCampaignId ?? null,
      utmSource: params.utmSource ?? null,
      utmMedium: params.utmMedium ?? null,
      utmCampaign: 'cmp_TESTHASH',
      utmContent: 'act_TESTHASH',
      utmTerm: params.utmTerm ?? null,
      createdAt: 't',
      updatedAt: 't',
    };
  }
}

const BASE: string = 'https://example-bakery.com';
const SLUG: string = 'summer-sale';
const CAMPAIGN_ID: string = 'camp_abc123abc1';

describe('utm-url-generator', () => {
  describe('assertPublishedBaseUrl', () => {
    it('accepts a published https URL', () => {
      expect(assertPublishedBaseUrl('https://shop.example.com').hostname).toBe('shop.example.com');
    });

    it('accepts http', () => {
      expect(assertPublishedBaseUrl('http://shop.example.com').protocol).toBe('http:');
    });

    it('rejects empty / missing', () => {
      expect(() => assertPublishedBaseUrl('')).toThrow(/published website is required/);
      expect(() => assertPublishedBaseUrl(null)).toThrow(/published website is required/);
    });

    it('rejects non-url and non-http(s)', () => {
      expect(() => assertPublishedBaseUrl('not a url')).toThrow(/Invalid published URL/);
      expect(() => assertPublishedBaseUrl('ftp://x.com')).toThrow(/must be http/);
    });

    it('rejects preview / builder / internal hosts (preview as a host LABEL)', () => {
      expect(() => assertPublishedBaseUrl('http://localhost:3000')).toThrow(/preview\/builder\/internal/);
      expect(() => assertPublishedBaseUrl('https://preview.example.com')).toThrow(/preview\/builder\/internal/);
      expect(() => assertPublishedBaseUrl('https://app.preview.example.com')).toThrow(/preview\/builder\/internal/);
      expect(() => assertPublishedBaseUrl('http://my-app.local')).toThrow(/preview\/builder\/internal/);
    });

    it('accepts a real published domain that merely contains the substring "preview"', () => {
      expect(assertPublishedBaseUrl('https://previewstudio.com').hostname).toBe('previewstudio.com');
      expect(assertPublishedBaseUrl('https://artpreview.io').hostname).toBe('artpreview.io');
    });
  });

  describe('buildUtmTerm', () => {
    it('builds topic_<slug> from a topic', () => {
      expect(buildUtmTerm('Summer Sale')).toBe('topic_summer-sale');
      expect(buildUtmTerm('already-slug')).toBe('topic_already-slug');
    });

    it('defaults to none when blank', () => {
      expect(buildUtmTerm()).toBe(UTM_TERM_NONE);
      expect(buildUtmTerm('   ')).toBe(UTM_TERM_NONE);
    });
  });

  describe('buildLandingPath', () => {
    it('assembles /lp/<slug> with utm params in canonical order', () => {
      const path: string = buildLandingPath(SLUG, {
        utmSource: UtmSource.Facebook,
        utmMedium: UtmMedium.OrganicSocial,
        utmCampaign: 'cmp_X',
        utmContent: 'act_Y',
        utmTerm: 'none',
      });
      expect(path).toBe('/lp/summer-sale?utm_source=facebook&utm_medium=organic_social&utm_campaign=cmp_X&utm_content=act_Y&utm_term=none');
    });
  });

  describe('generateDecoratedCampaignUrl', () => {
    it('decorates a facebook social post: absolute URL + persisted source/medium', () => {
      const writer: FakeUtmWriter = new FakeUtmWriter();
      const result: DecoratedUrlResult = generateDecoratedCampaignUrl({
        publishedUrl: BASE,
        campaignSlug: SLUG,
        resourceType: 'social',
        contentRefId: 'post-123',
        simpleCampaignId: CAMPAIGN_ID,
        platform: 'facebook',
        topicSlug: 'summer sale',
        utmWriter: writer,
      });

      expect(writer.lastParams?.utmSource).toBe(UtmSource.Facebook);
      expect(writer.lastParams?.utmMedium).toBe(UtmMedium.OrganicSocial);
      expect(writer.lastParams?.contentRefId).toBe('post-123');
      expect(writer.lastParams?.utmTerm).toBe('topic_summer-sale');

      expect(result.absoluteUrl).toBe(
        'https://example-bakery.com/lp/summer-sale?utm_source=facebook&utm_medium=organic_social&utm_campaign=cmp_TESTHASH&utm_content=act_TESTHASH&utm_term=topic_summer-sale',
      );
      expect(result.relativePath).toBe(
        '/lp/summer-sale?utm_source=facebook&utm_medium=organic_social&utm_campaign=cmp_TESTHASH&utm_content=act_TESTHASH&utm_term=topic_summer-sale',
      );
    });

    it('decorates an instagram social post', () => {
      const writer: FakeUtmWriter = new FakeUtmWriter();
      generateDecoratedCampaignUrl({
        publishedUrl: BASE,
        campaignSlug: SLUG,
        resourceType: 'social',
        contentRefId: 'post-ig',
        simpleCampaignId: CAMPAIGN_ID,
        platform: 'instagram',
        utmWriter: writer,
      });
      expect(writer.lastParams?.utmSource).toBe(UtmSource.Instagram);
      expect(writer.lastParams?.utmMedium).toBe(UtmMedium.OrganicSocial);
    });

    it('decorates a Google Business Profile post (accepts the SocialPlatform enum value, organic_social medium)', () => {
      const writer: FakeUtmWriter = new FakeUtmWriter();
      generateDecoratedCampaignUrl({
        publishedUrl: BASE,
        campaignSlug: SLUG,
        resourceType: 'social',
        contentRefId: 'gbp-1',
        simpleCampaignId: CAMPAIGN_ID,
        platform: 'GOOGLE_BUSINESS_PROFILE', // enum value form — lowercased internally
        utmWriter: writer,
      });
      expect(writer.lastParams?.utmSource).toBe(UtmSource.GoogleBusinessProfile);
      expect(writer.lastParams?.utmMedium).toBe(UtmMedium.OrganicSocial);
    });

    it('decorates a blog post with the blog-aab source and a relative path for same-origin use', () => {
      const writer: FakeUtmWriter = new FakeUtmWriter();
      const result: DecoratedUrlResult = generateDecoratedCampaignUrl({
        publishedUrl: BASE,
        campaignSlug: SLUG,
        resourceType: 'blog',
        contentRefId: 'post-blog1',
        simpleCampaignId: CAMPAIGN_ID,
        topicSlug: 'baking-tips',
        utmWriter: writer,
      });
      expect(writer.lastParams?.utmSource).toBe(UtmSource.BlogAab);
      expect(writer.lastParams?.utmMedium).toBe(UtmMedium.Blog);
      expect(result.relativePath.startsWith('/lp/summer-sale?')).toBe(true);
      expect(result.relativePath).toContain('utm_source=blog-aab');
      expect(result.relativePath).toContain('utm_medium=blog');
      expect(result.relativePath).toContain('utm_term=topic_baking-tips');
    });

    it('defaults utm_term to none when no topic is given', () => {
      const writer: FakeUtmWriter = new FakeUtmWriter();
      generateDecoratedCampaignUrl({
        publishedUrl: BASE,
        campaignSlug: SLUG,
        resourceType: 'blog',
        contentRefId: 'post-blog2',
        simpleCampaignId: CAMPAIGN_ID,
        utmWriter: writer,
      });
      expect(writer.lastParams?.utmTerm).toBe('none');
    });

    it('throws for social with an unsupported platform (incl. the multi-platform "all")', () => {
      expect(() =>
        generateDecoratedCampaignUrl({
          publishedUrl: BASE,
          campaignSlug: SLUG,
          resourceType: 'social',
          contentRefId: 'post-x',
          simpleCampaignId: CAMPAIGN_ID,
          platform: 'myspace',
          utmWriter: new FakeUtmWriter(),
        }),
      ).toThrow(/Unsupported social platform/);
      expect(() =>
        generateDecoratedCampaignUrl({
          publishedUrl: BASE,
          campaignSlug: SLUG,
          resourceType: 'social',
          contentRefId: 'post-x',
          simpleCampaignId: CAMPAIGN_ID,
          platform: 'all',
          utmWriter: new FakeUtmWriter(),
        }),
      ).toThrow(/Unsupported social platform/);
    });

    it('throws when campaignSlug is empty', () => {
      expect(() =>
        generateDecoratedCampaignUrl({
          publishedUrl: BASE,
          campaignSlug: '   ',
          resourceType: 'blog',
          contentRefId: 'post-x',
          simpleCampaignId: CAMPAIGN_ID,
          utmWriter: new FakeUtmWriter(),
        }),
      ).toThrow(/campaignSlug is required/);
    });

    it('throws when the base URL is a preview/internal URL', () => {
      expect(() =>
        generateDecoratedCampaignUrl({
          publishedUrl: 'http://localhost:3000',
          campaignSlug: SLUG,
          resourceType: 'blog',
          contentRefId: 'post-x',
          simpleCampaignId: CAMPAIGN_ID,
          utmWriter: new FakeUtmWriter(),
        }),
      ).toThrow(/preview\/builder\/internal/);
    });
  });
});

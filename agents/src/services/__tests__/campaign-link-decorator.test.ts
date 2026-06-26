import { describe, it, expect } from 'vitest';
import { UtmSource } from '../../database/schema.js';
import type { UTMAttributionParams } from '../../database/schema.js';
import type { CreateUTMAttributionParams } from '../../database/repositories/MarketingUtmRepository.js';
import type { UtmWriter, DecoratedUrlResult } from '../utm-url-generator.js';
import {
  isCampaignConversionCta,
  decorateConversionCtaLinks,
  decorateBlogCta,
  decorateSocialCta,
} from '../campaign-link-decorator.js';

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

const SLUG: string = 'summer-sale';
const BASE: string = 'https://example-bakery.com';
const CAMPAIGN_ID: string = 'camp_abc123abc1';

describe('campaign-link-decorator', () => {
  describe('isCampaignConversionCta — decorate the conversion CTA, skip incidental same-domain links', () => {
    it('matches the campaign landing path (relative, trailing slash, absolute)', () => {
      expect(isCampaignConversionCta('/lp/summer-sale', SLUG)).toBe(true);
      expect(isCampaignConversionCta('/lp/summer-sale/', SLUG)).toBe(true);
      expect(isCampaignConversionCta('https://example-bakery.com/lp/summer-sale', SLUG)).toBe(true);
    });

    it('skips incidental same-domain links (nav, other pages, blog-to-blog, other campaigns)', () => {
      expect(isCampaignConversionCta('/about', SLUG)).toBe(false);
      expect(isCampaignConversionCta('/blog/another-post', SLUG)).toBe(false);
      expect(isCampaignConversionCta('/lp/other-campaign', SLUG)).toBe(false);
      expect(isCampaignConversionCta('https://facebook.com/myprofile', SLUG)).toBe(false);
      expect(isCampaignConversionCta('', SLUG)).toBe(false);
    });
  });

  describe('decorateConversionCtaLinks', () => {
    const decorated: string = '/lp/summer-sale?utm_source=blog-aab&utm_medium=blog&utm_campaign=cmp_X&utm_content=act_Y&utm_term=none';

    it('decorates the conversion CTA inside a markdown link', () => {
      const md: string = 'Read on, then [grab the deal](/lp/summer-sale) before it ends.';
      expect(decorateConversionCtaLinks(md, SLUG, decorated)).toBe(
        `Read on, then [grab the deal](${decorated}) before it ends.`,
      );
    });

    it('decorates a bare/plain-text occurrence', () => {
      expect(decorateConversionCtaLinks('Visit /lp/summer-sale today', SLUG, decorated)).toBe(
        `Visit ${decorated} today`,
      );
    });

    it('leaves incidental same-domain links untouched', () => {
      const md: string = 'See [our story](/about) and [other post](/blog/x) — no tracking on those.';
      expect(decorateConversionCtaLinks(md, SLUG, decorated)).toBe(md);
    });

    it('does not double-decorate an already-decorated link', () => {
      const already: string = 'Buy at /lp/summer-sale?utm_source=facebook now';
      expect(decorateConversionCtaLinks(already, SLUG, decorated)).toBe(already);
    });

    it('does not match a different slug that shares a prefix', () => {
      const other: string = 'Old campaign at /lp/summer-sale-2023 stays bare';
      expect(decorateConversionCtaLinks(other, SLUG, decorated)).toBe(other);
    });

    it('replaces an absolute landing URL wholesale with a relative decoratedHref (no corruption)', () => {
      const text: string = 'Shop at https://example-bakery.com/lp/summer-sale now';
      expect(decorateConversionCtaLinks(text, SLUG, decorated)).toBe(`Shop at ${decorated} now`);
    });

    it('replaces an absolute landing URL wholesale with an absolute decoratedHref (no https://hosthttps://host)', () => {
      const absoluteDecorated: string = 'https://example-bakery.com/lp/summer-sale?utm_source=facebook&utm_medium=organic_social';
      const text: string = 'Shop at https://example-bakery.com/lp/summer-sale now';
      const result: string = decorateConversionCtaLinks(text, SLUG, absoluteDecorated);
      expect(result).toBe(`Shop at ${absoluteDecorated} now`);
      expect(result).not.toContain('comhttps://');
    });

    it('decorates an absolute landing URL inside a markdown link', () => {
      const md: string = '[Buy now](https://example-bakery.com/lp/summer-sale)';
      expect(decorateConversionCtaLinks(md, SLUG, decorated)).toBe(`[Buy now](${decorated})`);
    });

    it('leaves a protocol-relative cross-domain link untouched', () => {
      const text: string = 'Mirror at //other-cdn.com/lp/summer-sale stays bare';
      expect(decorateConversionCtaLinks(text, SLUG, decorated)).toBe(text);
    });
  });

  describe('decorateBlogCta / decorateSocialCta', () => {
    it('blog CTA mints a blog-aab row and returns a relative path', () => {
      const writer: FakeUtmWriter = new FakeUtmWriter();
      const result: DecoratedUrlResult = decorateBlogCta({
        publishedUrl: BASE,
        campaignSlug: SLUG,
        contentRefId: 'post-blog1',
        simpleCampaignId: CAMPAIGN_ID,
        topicSlug: 'baking-tips',
        utmWriter: writer,
      });
      expect(writer.lastParams?.utmSource).toBe(UtmSource.BlogAab);
      expect(result.relativePath.startsWith('/lp/summer-sale?')).toBe(true);
      expect(result.relativePath).toContain('utm_term=topic_baking-tips');
    });

    it('social CTA mints a platform-sourced row and returns an absolute URL', () => {
      const writer: FakeUtmWriter = new FakeUtmWriter();
      const result: DecoratedUrlResult = decorateSocialCta({
        publishedUrl: BASE,
        campaignSlug: SLUG,
        contentRefId: 'post-fb1',
        simpleCampaignId: CAMPAIGN_ID,
        platform: 'facebook',
        utmWriter: writer,
      });
      expect(writer.lastParams?.utmSource).toBe(UtmSource.Facebook);
      expect(result.absoluteUrl.startsWith('https://example-bakery.com/lp/summer-sale?')).toBe(true);
    });
  });
});

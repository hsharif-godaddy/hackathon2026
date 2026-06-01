import { describe, expect, it, vi } from 'vitest';

import {
  fetchPublishedUrlViaGetSiteData,
  fetchSiteSeoContextViaGetSiteData,
  resolvePublishedUrlFromToolContext,
  siteSeoContextFromGetSiteData,
} from '../site-published-url.js';
import type { IClientActionService } from '../ClientActionService.js';

describe('site-published-url', () => {
  describe('fetchPublishedUrlViaGetSiteData', () => {
    it('returns publishedUrl from getSiteData result', async () => {
      const clientActionService = {
        executeAction: vi.fn().mockResolvedValue({
          success: true,
          result: { publishedUrl: 'https://live.example.com' },
        }),
      } satisfies Pick<IClientActionService, 'executeAction'>;

      const url = await fetchPublishedUrlViaGetSiteData(
        'app-123',
        clientActionService as IClientActionService,
      );

      expect(url).toBe('https://live.example.com');
      expect(clientActionService.executeAction).toHaveBeenCalledWith({
        action: 'getSiteData',
        params: { appId: 'app-123' },
        timeoutMs: 10_000,
      });
    });

    it('returns null when getSiteData fails', async () => {
      const clientActionService = {
        executeAction: vi.fn().mockResolvedValue({ success: false }),
      } satisfies Pick<IClientActionService, 'executeAction'>;

      const url = await fetchPublishedUrlViaGetSiteData(
        'app-123',
        clientActionService as IClientActionService,
      );

      expect(url).toBeNull();
    });
  });

  describe('siteSeoContextFromGetSiteData', () => {
    it('marks unpublished when publish URL exists but variant is inactive', () => {
      const context = siteSeoContextFromGetSiteData({
        publishedUrl: 'https://live.example.com',
        previewUrl: 'https://preview.example.com',
        variantsWithLifecycle: [{ variant: 'publish', status: 'inactive' }],
      });

      expect(context.isPublished).toBe(false);
      expect(context.publishedUrl).toBe('https://live.example.com');
      expect(context.previewUrl).toBe('https://preview.example.com');
    });

    it('marks published when publish variant is active', () => {
      const context = siteSeoContextFromGetSiteData({
        publishedUrl: 'https://live.example.com',
        variants: ['publish'],
      });

      expect(context.isPublished).toBe(true);
    });
  });

  describe('fetchSiteSeoContextViaGetSiteData', () => {
    it('returns preview URL and publish flag from getSiteData', async () => {
      const clientActionService = {
        executeAction: vi.fn().mockResolvedValue({
          success: true,
          result: {
            publishedUrl: 'https://live.example.com',
            previewUrl: 'https://preview.example.com',
            variantsWithLifecycle: [{ variant: 'preview', status: 'active' }],
          },
        }),
      } satisfies Pick<IClientActionService, 'executeAction'>;

      const context = await fetchSiteSeoContextViaGetSiteData(
        'app-123',
        clientActionService as IClientActionService,
      );

      expect(context.isPublished).toBe(false);
      expect(context.previewUrl).toBe('https://preview.example.com');
    });
  });

  describe('resolvePublishedUrlFromToolContext', () => {
    it('returns null without socketId', async () => {
      const url = await resolvePublishedUrlFromToolContext('app-123', {});
      expect(url).toBeNull();
    });
  });
});

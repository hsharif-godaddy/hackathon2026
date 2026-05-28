/**
 * Getty Upload Service
 *
 * Calls the GoDaddy Getty Images proxy `/v1/upload` endpoint to download
 * licensed images to CDN (isteam/S3) and optionally report usage to Getty.
 * Used at image placement time (setSlot/updateSlot) to replace preview URLs
 * with permanent CDN URLs.
 *
 * Auth and HTTP lifecycle use `BaseDriverV2` (same as `GettyMediaDriver`):
 * `USE_S2S_AUTH`, `S2S_AWS_PROFILE`, and `SSO_HOST` from env.
 *
 * The legacy `GETTY_TOKEN` Bearer path has been removed.
 */

import { BaseDriverV2 } from '../tools/ai-lib-tools/drivers/base-driver-v2.js';
import {
  GETTY_CONFIG_LEGACY_TOKEN_NOTICE,
  GETTY_CONFIG_MEDIA_AUTH_MISSING,
} from '../tools/ai-lib-tools/drivers/getty-config-messages.js';
import { logger } from '../logging/index.js';

export interface UploadResult {
  id: string;
  url: string;
  dimensions?: { height: number; width: number };
}

export class GettyUploadService extends BaseDriverV2 {
  constructor() {
    if (process.env.GETTY_TOKEN) {
      logger.warn('getty_upload.config.getty_token_ignored', {
        message: GETTY_CONFIG_LEGACY_TOKEN_NOTICE,
      });
    }

    const configuredUrl =
      process.env.GETTY_IMAGE_PROXY_URL || 'https://getty-images-proxy.api.dev-godaddy.com';
    super({
      serviceName: 'getty-upload',
      baseUrl: configuredUrl,
      appKeyEnvVar: 'GETTY_APP_KEY',
      defaultAppKey: 'airo-app-builder',
    });

    logger.info('getty_upload.config.initialized', {
      configuredUrl,
      apiBaseUrl: this.apiBaseUrl,
      configured: this.hasAuth(),
    });

    if (!this.hasAuth()) {
      logger.warn('getty_upload.auth.missing', {
        message: GETTY_CONFIG_MEDIA_AUTH_MISSING,
      });
    }
  }

  /**
   * Upload Getty images to CDN and report usage in a single call.
   * Returns CDN URLs for each image ID.
   *
   * @param gettyIds - Array of Getty image IDs to upload
   * @returns Array of upload results with CDN URLs, or empty array on failure
   */
  async uploadAndReport(gettyIds: string[]): Promise<UploadResult[]> {
    if (!gettyIds.length) return [];

    if (!this.apiBaseUrl || !this.hasAuth()) {
      logger.warn('getty_upload.missing_config', {
        baseUrlConfigured: !!this.apiBaseUrl,
        configured: this.hasAuth(),
      });
      return [];
    }

    try {
      logger.info('getty_upload.begin', {
        ids: gettyIds,
        count: gettyIds.length,
      });

      const response = await this.post('/v1/upload?reportUsage=true', { ids: gettyIds });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('getty_upload.upstream_error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          ids: gettyIds,
        });
        return [];
      }

      const data = (await response.json()) as UploadResult[];

      logger.info('getty_upload.success', {
        ids: gettyIds,
        resultCount: data.length,
      });

      return data;
    } catch (error) {
      logger.error('getty_upload.error', {
        ids: gettyIds,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return [];
    }
  }

  /**
   * Report usage for already-uploaded images (e.g., when re-using a CDN image).
   * Fire-and-forget — does not block on response.
   */
  reportUsage(gettyIds: string[]): void {
    if (!gettyIds.length || !this.apiBaseUrl || !this.hasAuth()) {
      return;
    }

    logger.info('getty_usage_report.begin', { ids: gettyIds, count: gettyIds.length });

    void this.reportUsageAsync(gettyIds);
  }

  private async reportUsageAsync(gettyIds: string[]): Promise<void> {
    try {
      const response = await this.put('/v1/usage', { ids: gettyIds });

      if (!response.ok) {
        logger.warn('getty_usage_report.upstream_error', {
          ids: gettyIds,
          status: response.status,
          statusText: response.statusText,
        });
      }
    } catch (error) {
      logger.warn('getty_usage_report.error', {
        ids: gettyIds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const gettyUploadService = new GettyUploadService();

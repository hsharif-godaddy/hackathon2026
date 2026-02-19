/**
 * Getty Upload Service
 *
 * Calls our Getty proxy's /v1/upload endpoint to download licensed images
 * to CDN (isteam/S3) and optionally report usage to Getty.
 *
 * Used at image placement time (setSlot/updateSlot) to replace preview URLs
 * with permanent CDN URLs.
 */

import { logger } from '../logging/index.js';

export interface UploadResult {
  id: string;
  url: string;
  dimensions?: { height: number; width: number };
}

export class GettyUploadService {
  private apiBaseUrl: string;
  private authHeader: string;
  private appKey: string;

  constructor() {
    this.apiBaseUrl = this.parseBaseUrl(process.env.GETTY_API_URL || '');
    this.authHeader = process.env.GETTY_TOKEN ? `Bearer ${process.env.GETTY_TOKEN}` : '';
    this.appKey = process.env.GETTY_APP_KEY || 'airo-app-builder';
  }

  private parseBaseUrl(baseUrl: string): string {
    if (!baseUrl) return '';
    try {
      const urlObj = new URL(baseUrl);
      return `${urlObj.protocol}//${urlObj.host}`;
    } catch {
      return baseUrl.replace(/\/.*$/, '');
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

    if (!this.apiBaseUrl || !this.authHeader) {
      logger.warn('getty_upload.missing_config', {
        hasBaseUrl: !!this.apiBaseUrl,
        hasAuth: !!this.authHeader,
      });
      return [];
    }

    try {
      logger.info('getty_upload.begin', {
        ids: gettyIds,
        count: gettyIds.length,
      });

      const url = `${this.apiBaseUrl}/v1/upload?reportUsage=true`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'x-app-key': this.appKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ ids: gettyIds }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn('getty_upload.upstream_error', {
          status: response.status,
          error: errorText,
          ids: gettyIds,
        });
        return [];
      }

      const data = await response.json() as UploadResult[];

      logger.info('getty_upload.success', {
        ids: gettyIds,
        resultCount: data.length,
      });

      return data;
    } catch (error) {
      logger.warn('getty_upload.error', {
        ids: gettyIds,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Report usage for already-uploaded images (e.g., when re-using a CDN image).
   * Fire-and-forget — does not block on response.
   */
  reportUsage(gettyIds: string[]): void {
    if (!gettyIds.length || !this.apiBaseUrl || !this.authHeader) return;

    logger.info('getty_usage_report.begin', { ids: gettyIds, count: gettyIds.length });

    const url = `${this.apiBaseUrl}/v1/usage`;
    fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': this.authHeader,
        'x-app-key': this.appKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ ids: gettyIds }),
    }).catch(error => {
      logger.warn('getty_usage_report.error', {
        ids: gettyIds,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

export const gettyUploadService = new GettyUploadService();

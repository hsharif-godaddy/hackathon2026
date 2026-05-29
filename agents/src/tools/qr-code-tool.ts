import QRCode from 'qrcode';
import { nanoid } from 'nanoid';
import { AppRepository } from '../database/repositories/AppRepository.js';
import type { IClientActionService } from '../services/ClientActionService.js';
import { logger } from '../logging/index.js';
import { createForWorkspace } from '../workspace/index.js';

export interface QRCodeOptions {
  targetPage?: string;
  size?: number; // Default 1000px for high quality
  appId: string;
  clientActionService?: IClientActionService; // Optional: for fetching published URL from client
}

export interface QRCodeResult {
  success: boolean;
  filepath?: string;
  targetUrl?: string;
  size?: number;
  base64?: string;
  error?: string;
}

/**
 * QR Code generation tool for creating QR codes that link to app pages
 */
export class QRCodeTool {
  /**
   * Generate a QR code for a specific page of the app
   */
  async generateQRCode(options: QRCodeOptions): Promise<QRCodeResult> {
    const { targetPage = '/', size = 1000, appId, clientActionService } = options;

    const logData = {
      toolName: 'qr-code-tool',
      appId,
      targetPage,
      size
    };

    logger.info('qrCode.generate.begin', logData);

    try {
      // Get app and preview URL from local SQLite
      const appRepository: AppRepository = new AppRepository();
      const app = appRepository.findById(appId);

      if (!app) {
        logger.error('qrCode.generate.failure', {
          ...logData,
          error: 'App not found'
        });
        return {
          success: false,
          error: 'App not found'
        };
      }

      // Try to get published URL from client (MySQL) if ClientActionService is available
      let publishedUrl: string | null = null;
      if (clientActionService) {
        try {
          logger.debug('qrCode.generate.fetching-site-data', logData);
          const siteDataResult = await clientActionService.executeAction({
            action: 'getSiteData',
            params: { appId },
            timeoutMs: 10000,
          });

          if (siteDataResult.success && siteDataResult.result) {
            const siteData = siteDataResult.result as { publishedUrl?: string };
            publishedUrl = siteData.publishedUrl || null;
            logger.debug('qrCode.generate.site-data-fetched', {
              ...logData,
              hasPublishedUrl: !!publishedUrl
            });
          }
        } catch (error) {
          logger.warn('qrCode.generate.site-data-fetch-failed', {
            ...logData,
            error: error instanceof Error ? error.message : String(error)
          });
          // Continue with preview URL fallback
        }
      }

      // Prefer published URL over preview URL for QR codes
      const baseUrl: string | undefined = publishedUrl || app.previewUrl;
      if (!baseUrl) {
        logger.error('qrCode.generate.failure', {
          ...logData,
          error: 'No URL available (preview or published)'
        });
        return {
          success: false,
          error: 'No URL available for QR code generation'
        };
      }

      // Construct target URL
      const cleanPage: string = targetPage.startsWith('/') ? targetPage : `/${targetPage}`;
      const targetUrl: string = `${baseUrl.replace(/\/+$/, '')}${cleanPage}`;

      // Generate safe filename from page path
      const pageSlug: string = cleanPage === '/' ? 'home' : cleanPage.replace(/^\//, '').replace(/\//g, '_');
      const filename: string = `qr-${pageSlug}-${nanoid(6)}.png`;

      // Generate QR code to buffer
      const qrBuffer: Buffer = await QRCode.toBuffer(targetUrl, {
        width: size,
        margin: 4,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      // Upload via workspace files
      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) {
        logger.error('qrCode.generate.failure', {
          ...logData,
          error: 'Workspace not available'
        });
        return {
          success: false,
          error: 'Workspace not available'
        };
      }

      const uploadPath: string = `public/assets/qr-codes/${filename}`;
      await workspace.files.upload({ path: uploadPath, data: qrBuffer });

      // Generate base64 version for chat display
      const base64QRCode: string = `data:image/png;base64,${qrBuffer.toString('base64')}`;

      logger.info('qrCode.generate.success', {
        ...logData,
        resultStats: {
          success: true,
          uploadPath,
          targetUrl
        }
      });

      return {
        success: true,
        filepath: uploadPath,
        targetUrl,
        size,
        base64: base64QRCode
      };
    } catch (error) {
      logger.error('qrCode.generate.failure', {
        ...logData,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        success: false,
        error: `QR code generation failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * Function interface for QR code generation
 */
export async function generateQRCode(options: QRCodeOptions): Promise<QRCodeResult> {
  const tool: QRCodeTool = new QRCodeTool();
  return tool.generateQRCode(options);
}

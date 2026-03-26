import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { nanoid } from 'nanoid';
import { AppRepository } from '../database/repositories/AppRepository.js';
import type { ClientActionService } from '../services/ClientActionService.js';
import { logger } from '../logging/index.js';
import { getPersistentPublicDir } from '../utils/persistent-assets.js';

export interface QRCodeOptions {
  targetPage?: string;
  size?: number; // Default 1000px for high quality
  appId: string;
  clientActionService?: ClientActionService; // Optional: for fetching published URL from client
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
  private appsBaseDir: string;

  constructor(appsBaseDir?: string) {
    this.appsBaseDir = appsBaseDir || process.env.APPS_BASE_DIR || '/tmp/airo-app-builder';
  }

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
      const appRepository = new AppRepository();
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
      const baseUrl = publishedUrl || app.previewUrl;
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
      const cleanPage = targetPage.startsWith('/') ? targetPage : `/${targetPage}`;
      const targetUrl = `${baseUrl.replace(/\/+$/, '')}${cleanPage}`;

      // Setup directories using the app's actual path
      const appPath = app.path;
      const publicDir = getPersistentPublicDir(appPath);
      const qrCodesDir = path.join(publicDir, 'qr-codes');

      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      if (!fs.existsSync(qrCodesDir)) {
        fs.mkdirSync(qrCodesDir, { recursive: true });
      }

      // Generate safe filename from page path
      const pageSlug = cleanPage === '/' ? 'home' : cleanPage.replace(/^\//, '').replace(/\//g, '_');
      const filename = `qr-${pageSlug}-${nanoid(6)}.png`;
      const filePath = path.join(qrCodesDir, filename);

      // Generate QR code
      await QRCode.toFile(filePath, targetUrl, {
        width: size,
        margin: 4,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      // Generate base64 version for chat display
      const qrImageBuffer = fs.readFileSync(filePath);
      const base64QRCode = `data:image/png;base64,${qrImageBuffer.toString('base64')}`;

      logger.info('qrCode.generate.success', {
        ...logData,
        resultStats: {
          success: true,
          filePath,
          targetUrl
        }
      });

      return {
        success: true,
        filepath: filePath,
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
  const tool = new QRCodeTool();
  return tool.generateQRCode(options);
}

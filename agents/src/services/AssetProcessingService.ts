import crypto from 'node:crypto';
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createAgentFactory, getModel, createFileInput, processFile } from '@airo/ai-lib';
import sharp from 'sharp';

import { Logger } from '../logging/index.js';
import { createAgentTelemetryLogger } from '../utils/agent-logger.js';
import { normalizeAssetPath } from '../utils/asset-paths.js';
import { getPersistentPublicDir } from '../utils/persistent-assets.js';
import { normalizeRebuildPageKey } from '../utils/rebuild-utils.js';
import type { AssetInfo, AssetManifest, ImagePlacement } from '../types/rebuild.js';

interface AssetRow {
  url: string;
  type: 'image' | 'font' | 'icon' | 'other';
  altText?: string;
  sourceUrl: string;
  dimensions?: { width: number; height: number };
  placement?: ImagePlacement;
}

const logger = Logger.create({ component: 'asset-processing-service' });

/**
 * Asset download result
 */
interface AssetDownloadResult {
  success: boolean;
  localPath?: string;
  error?: string;
}

/**
 * Asset Processing Service
 * 
 * Downloads and processes assets from scraped websites
 * Generates AI descriptions for images using vision models
 */
export class AssetProcessingService {
  private appPath: string;
  private assetsDir: string;
  private publicDir: string;
  private readonly MAX_IMAGES_TO_DESCRIBE = 50;
  private readonly CONCURRENCY_LIMIT = 5;
  private readonly MAX_IMAGE_DIMENSION_FOR_AI = 1200;
  private readonly MAX_ASSET_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50MB limit for asset downloads
  private readonly IMAGE_HEADER_READ_SIZE = 1024; // Read only first 1KB for dimension extraction
  private imagesDescribedCount = 0;

  constructor(appPath: string) {
    this.appPath = appPath;
    this.assetsDir = path.join(appPath, '.source-site', 'assets');
    this.publicDir = getPersistentPublicDir(this.appPath);
  }

  /**
   * Process and download assets
   *
   * @param assets - Array of asset URLs to process
   * @param sourcePages - Map of asset URLs to source pages
   * @param options - merge: extend existing manifest (dedupe by asset URL, merge sourcePages)
   * @returns Promise resolving to asset manifest
   */
  async process(
    assets: AssetRow[],
    sourcePages: Map<string, string[]>,
    options?: { merge?: boolean }
  ): Promise<AssetManifest> {
    try {
      logger.info('asset-processing.begin', {
        totalAssets: assets.length,
        appPath: this.appPath,
        concurrencyLimit: this.CONCURRENCY_LIMIT
      });

      await this.ensureDirectories();

      const byUrl = new Map<string, AssetInfo>();
      if (options?.merge) {
        const existing = await this.loadManifestIfExists();
        if (existing) {
          for (const a of existing.assets) {
            byUrl.set(a.url, a);
          }
        }
      }

      const toProcess: AssetRow[] = [];
      const queuedUrl = new Set<string>();

      for (const row of assets) {
        const pagesForUrl = sourcePages.get(row.url) ?? [row.sourceUrl];
        const hit = byUrl.get(row.url);
        if (hit) {
          byUrl.set(row.url, {
            ...hit,
            sourcePages: this.combineSourcePages(hit.sourcePages, pagesForUrl),
            ...(!hit.dimensions && row.dimensions ? { dimensions: row.dimensions } : {}),
            ...(!hit.placement && row.placement ? { placement: row.placement } : {}),
          });
          continue;
        }
        if (queuedUrl.has(row.url)) {
          continue;
        }
        queuedUrl.add(row.url);
        toProcess.push(row);
      }

      const results =
        toProcess.length > 0
          ? await this.processAssetsWithConcurrency(toProcess, sourcePages)
          : [];

      for (const result of results) {
        if (result) {
          byUrl.set(result.url, result);
        }
      }

      const processedAssets = dedupeImageVariants([...byUrl.values()]);
      const byType = {
        image: 0,
        font: 0,
        icon: 0,
        other: 0
      };

      for (const a of processedAssets) {
        byType[a.type]++;
      }

      const manifest: AssetManifest = {
        assets: processedAssets,
        totalAssets: processedAssets.length,
        byType,
        generatedAt: new Date().toISOString()
      };

      await this.saveManifest(manifest);
      await this.createImagesMarkdown(processedAssets);

      logger.info('asset-processing.complete', {
        totalAssets: processedAssets.length,
        byType,
        imagesDescribed: this.imagesDescribedCount,
        maxImagesDescribed: this.MAX_IMAGES_TO_DESCRIBE
      });

      return manifest;
    } catch (error) {
      logger.error('asset-processing.error', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private combineSourcePages(a: string[] | undefined, b: string[] | undefined): string[] {
    return [...new Set([...(a ?? []), ...(b ?? [])])];
  }

  private async loadManifestIfExists(): Promise<AssetManifest | null> {
    try {
      const manifestPath = path.join(this.assetsDir, 'manifest.json');
      const raw = await readFile(manifestPath, 'utf-8');
      return JSON.parse(raw) as AssetManifest;
    } catch {
      return null;
    }
  }

  /**
   * Process assets with concurrency control
   * 
   * @param assets - Assets to process
   * @param sourcePages - Map of asset URLs to source pages
   * @returns Promise resolving to array of processed assets
   */
  private async processAssetsWithConcurrency(
    assets: AssetRow[],
    sourcePages: Map<string, string[]>
  ): Promise<(AssetInfo | null)[]> {
    if (assets.length === 0) {
      return [];
    }

    const results: (AssetInfo | null)[] = new Array(assets.length);
    let activeCount = 0;
    let currentIndex = 0;

    return new Promise((resolve) => {
      const processNext = () => {
        while (activeCount < this.CONCURRENCY_LIMIT && currentIndex < assets.length) {
          const index = currentIndex++;
          const asset = assets[index];
          
          if (!asset) {
            continue;
          }
          
          activeCount++;

          this.processAsset(asset, sourcePages.get(asset.url) || [])
            .then(result => {
              results[index] = result;
            })
            .catch(error => {
              logger.warn('asset-processing.parallel-error', {
                url: asset.url,
                error: error instanceof Error ? error.message : String(error)
              });
              results[index] = null;
            })
            .finally(() => {
              activeCount--;
              if (currentIndex < assets.length) {
                processNext();
              } else if (activeCount === 0) {
                resolve(results);
              }
            });
        }
      };

      processNext();
    });
  }

  /**
   * Process a single asset
   * 
   * @param asset - Asset to process
   * @param sourcePages - Pages where asset is used
   * @returns Promise resolving to asset info or null
   */
  private async processAsset(
    asset: AssetRow,
    sourcePages: string[]
  ): Promise<AssetInfo | null> {
    try {
      const downloadResult = await this.downloadAsset(asset.url, asset.type);

      if (!downloadResult.success || !downloadResult.localPath) {
        // Error already logged in downloadAsset method with full details
        return null;
      }

      const assetInfo: AssetInfo = {
        url: asset.url,
        localPath: downloadResult.localPath,
        type: asset.type,
        ...(asset.altText ? { altText: asset.altText } : {}),
        sourcePages
      };

      if (asset.type === 'image') {
        // Prefer Atlas-provided dimensions; fall back to reading file header
        const dimensions = asset.dimensions ?? await this.getImageDimensions(downloadResult.localPath);
        if (dimensions) {
          assetInfo.dimensions = dimensions;
        }

        if (asset.placement) {
          assetInfo.placement = asset.placement;
        }

        // Get file size
        const fileSize = await this.getFileSize(downloadResult.localPath);
        if (fileSize) {
          assetInfo.fileSize = fileSize;
        }

        // Skip AI description during initial download - will be generated lazily when needed
        // This defers the cost until we know which images are actually used
        logger.debug('asset-processing.image-description-deferred', {
          url: asset.url,
          reason: 'Will be analyzed on-demand when page is built'
        });
      }

      return assetInfo;
    } catch (error) {
      logger.warn('asset-processing.asset-error', {
        url: asset.url,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Download asset to local storage and copy to public directory
   * 
   * Downloads with size limit to prevent memory exhaustion from large files.
   * Maximum download size is 50MB per asset.
   * 
   * @param url - Asset URL
   * @param type - Asset type
   * @returns Promise resolving to download result
   */
  private async downloadAsset(url: string, type: string): Promise<AssetDownloadResult> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AiroBuilder/1.0)'
        }
      });

      if (!response.ok) {
        logger.warn('asset-processing.http-error', {
          url,
          status: response.status,
          statusText: response.statusText
        });
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      // Check content length before downloading
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > this.MAX_ASSET_DOWNLOAD_SIZE) {
        logger.warn('asset-processing.file-too-large', {
          url,
          contentLength: parseInt(contentLength, 10),
          maxSize: this.MAX_ASSET_DOWNLOAD_SIZE,
          message: `Asset exceeds maximum download size of ${this.MAX_ASSET_DOWNLOAD_SIZE / 1024 / 1024}MB`
        });
        return {
          success: false,
          error: `File too large (${(parseInt(contentLength, 10) / 1024 / 1024).toFixed(2)}MB exceeds ${this.MAX_ASSET_DOWNLOAD_SIZE / 1024 / 1024}MB limit)`
        };
      }

      const buffer = await response.arrayBuffer();
      
      // Double-check actual size after download
      if (buffer.byteLength > this.MAX_ASSET_DOWNLOAD_SIZE) {
        logger.warn('asset-processing.downloaded-file-too-large', {
          url,
          actualSize: buffer.byteLength,
          maxSize: this.MAX_ASSET_DOWNLOAD_SIZE,
          message: 'Downloaded file exceeds size limit'
        });
        return {
          success: false,
          error: `Downloaded file too large (${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB exceeds ${this.MAX_ASSET_DOWNLOAD_SIZE / 1024 / 1024}MB limit)`
        };
      }
      const hash = crypto.createHash('md5').update(Buffer.from(buffer)).digest('hex');
      const ext = this.getExtensionFromUrl(url) || this.getExtensionFromType(type);
      const filename = `${hash}${ext}`;

      // Save to .source-site/assets directory
      const typeDir = path.join(this.assetsDir, type === 'image' ? 'images' : 'other');
      await mkdir(typeDir, { recursive: true });

      const localPath = path.join(typeDir, filename);
      await writeFile(localPath, Buffer.from(buffer));

      // Also copy to public directory for use in the app
      const publicTypeDir = path.join(this.publicDir, type === 'image' ? 'images' : 'other');
      await mkdir(publicTypeDir, { recursive: true });

      const publicPath = path.join(publicTypeDir, filename);
      await writeFile(publicPath, Buffer.from(buffer));

      const relativePath = path.relative(this.appPath, localPath);

      logger.debug('asset-processing.download-success', {
        url,
        localPath: relativePath,
        publicPath
      });

      return {
        success: true,
        localPath: relativePath
      };
    } catch (error) {
      logger.warn('asset-processing.fetch-error', {
        url,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Generate AI description for an image
   * 
   * @param localPath - Local path to the image file
   * @param existingAlt - Existing alt text
   * @param dimensions - Original image dimensions for resize decision
   * @returns Promise resolving to description or null
   */
  async generateImageDescription(
    localPath: string,
    existingAlt?: string,
    dimensions?: { width: number; height: number }
  ): Promise<ImageDescriptionResult | null> {
    let cleanup: (() => Promise<void>) | null = null;
    
    try {
      // Resize image if needed to reduce token costs
      const { imagePath, cleanup: cleanupFn } = dimensions 
        ? await this.resizeImageForAI(localPath, dimensions)
        : { imagePath: path.join(this.appPath, localPath), cleanup: async () => {} };
      
      cleanup = cleanupFn;

      logger.info('asset-processing.describe-image', {
        localPath,
        imagePath,
        hasAltText: !!existingAlt,
        dimensions
      });

      // Process image file using ai-lib
      const fileInput = createFileInput(imagePath);
      const processedFile = await processFile(fileInput);

      // Create agent for image analysis (using Haiku for cost efficiency)
      const model = await getModel('haiku');
      const agentFactory = createAgentFactory();
      
      const agents = agentFactory.defineAgents({
        imageAnalyst: {
          name: 'Image Description Agent',
          system: `You are an expert at analyzing images for web development purposes.
Analyze the image and provide:
1. A detailed description (2-3 sentences) of what the image shows
2. The compositional layout - WHERE the visual interest is located (e.g., "subject on left", "centered", "subject on right", "full-bleed texture", "top-heavy", "bottom-weighted")
3. The usage context (one of: hero, icon, logo, background, product, profile, decorative, content, general)
4. Whether the image has readable text (headlines, taglines, brand names, slogans) burned directly into its pixels. If yes, transcribe it. Stylized/decorative/cursive fonts count. Watermarks and tiny copyright lines do NOT count.

This composition information is CRITICAL for layout decisions. For example:
- If a car/product is on the left side, content should overlay on the right
- If a person is on the right, content should go left
- If it's a centered subject, use split layout or overlay carefully
- If it's a texture/pattern, full overlay is safe

The embedded-text signal matters because if a hero image already has its heading baked in, the page must NOT overlay another heading on top of it (that would double the text).

${existingAlt ? `The image has this alt text: "${existingAlt}"` : ''}

Respond ONLY with valid JSON in this exact format:
{
  "description": "detailed description here",
  "composition": "where the visual interest is (left/right/center/full/top/bottom)",
  "usageContext": "context here",
  "hasEmbeddedText": true/false,
  "embeddedText": "the readable text if any, or null"
}`,
          model,
          maxSteps: 1,
          temperature: 0.3,
          maxOutputTokens: 500,
          logger: createAgentTelemetryLogger('image-analyst')
        }
      });

      const agent = agents.get('imageAnalyst');
      const result = await agent.generate('Analyze this image and provide the description and usage context in JSON format.', {
        files: [processedFile]
      });

      const parsed = parseImageDescriptionResponse(
        result.content.match(/\{[\s\S]*\}/)?.[0],
        existingAlt
      );

      // Cleanup temp file before returning. Null it so the catch's
      // `if (cleanup)` guard can't fire a second unlink if cleanup() threw.
      await cleanup();
      cleanup = null;

      if (parsed) {
        logger.info('asset-processing.description-generated', {
          localPath,
          description: parsed.description.substring(0, 50) + '...',
          composition: parsed.composition,
          usageContext: parsed.usageContext,
          hasEmbeddedText: parsed.hasEmbeddedText
        });
        return parsed;
      }

      // No parseable JSON (no object matched, or malformed) — the model
      // misbehaved; warn and fall back to alt-text-derived values.
      logger.warn('asset-processing.description-parse-failed', {
        localPath,
        response: result.content
      });
      return fallbackImageDescription(existingAlt);
    } catch (error) {
      logger.warn('asset-processing.description-error', {
        localPath,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Ensure cleanup happens even on error
      if (cleanup) {
        await cleanup();
      }
      
      return fallbackImageDescription(existingAlt);
    }
  }

  /**
   * Get image dimensions by reading image header
   * 
   * Reads only the first 1KB of the file to extract dimension information
   * from the image header. This prevents loading large files into memory.
   * All supported formats (PNG, JPEG, GIF, WebP) have dimension info in the first 1KB.
   * 
   * @param localPath - Local path to image file
   * @returns Promise resolving to dimensions or null
   */
  private async getImageDimensions(localPath: string): Promise<{ width: number; height: number } | null> {
    let fileHandle;
    try {
      const imagePath = path.join(this.appPath, localPath);
      
      // Open file and read only first 1KB to prevent loading entire file into memory
      fileHandle = await open(imagePath, 'r');
      const buffer = Buffer.alloc(this.IMAGE_HEADER_READ_SIZE);
      const { bytesRead } = await fileHandle.read(buffer, 0, this.IMAGE_HEADER_READ_SIZE, 0);

      // PNG: Check signature and read IHDR chunk
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }

      // JPEG: Find SOF marker
      if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
        let offset = 2;
        while (offset < buffer.length - 10) {
          if (buffer[offset] !== 0xFF) break;
          
          const marker = buffer[offset + 1];
          if (marker === undefined) break;
          
          const size = buffer.readUInt16BE(offset + 2);
          
          // SOF markers (Start of Frame)
          if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || 
              (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            return { width, height };
          }
          
          offset += 2 + size;
        }
      }

      // GIF: Read logical screen descriptor
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        const width = buffer.readUInt16LE(6);
        const height = buffer.readUInt16LE(8);
        return { width, height };
      }

      // WebP: Parse RIFF container
      if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
          buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        // VP8 lossy
        if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
          const width = buffer.readUInt16LE(26) & 0x3FFF;
          const height = buffer.readUInt16LE(28) & 0x3FFF;
          return { width, height };
        }
        // VP8L lossless
        if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4C) {
          const bits = buffer.readUInt32LE(21);
          const width = ((bits & 0x3FFF) + 1);
          const height = (((bits >> 14) & 0x3FFF) + 1);
          return { width, height };
        }
      }

      // Log unsupported format with file signature for debugging
      const signature = buffer.slice(0, 4).toString('hex');
      logger.warn('asset-processing.dimensions-unsupported-format', {
        localPath,
        fileSignature: signature,
        bufferLength: buffer.length,
        message: 'Unsupported image format - dimension extraction not implemented for this format'
      });
      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = (error as any)?.code;
      
      // Distinguish between different failure modes
      if (errorCode === 'ENOENT') {
        logger.warn('asset-processing.dimensions-file-not-found', {
          localPath,
          message: 'Image file not found - may have been deleted or moved'
        });
      } else if (errorCode === 'EACCES') {
        logger.warn('asset-processing.dimensions-permission-denied', {
          localPath,
          message: 'Permission denied reading image file'
        });
      } else if (errorMessage.includes('out of range') || errorMessage.includes('buffer')) {
        logger.warn('asset-processing.dimensions-corrupted-file', {
          localPath,
          error: errorMessage,
          message: 'Image file appears to be corrupted or truncated'
        });
      } else {
        logger.warn('asset-processing.dimensions-parse-error', {
          localPath,
          error: errorMessage,
          errorCode,
          message: 'Failed to parse image dimensions'
        });
      }
      return null;
    } finally {
      // Always close file handle to prevent resource leaks
      if (fileHandle) {
        await fileHandle.close();
      }
    }
  }

  /**
   * Get file size in bytes
   * 
   * @param localPath - Local path to file
   * @returns Promise resolving to file size or null
   */
  private async getFileSize(localPath: string): Promise<number | null> {
    try {
      const filePath = path.join(this.appPath, localPath);
      const stats = await stat(filePath);
      return stats.size;
    } catch (error) {
      logger.warn('asset-processing.filesize-error', {
        localPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Resize image for AI analysis if needed
   * Creates a temporary resized version optimized for Claude's token usage
   * 
   * @param localPath - Path to original image
   * @param originalDimensions - Original image dimensions
   * @returns Path to resized image (or original if no resize needed) and cleanup function
   */
  private async resizeImageForAI(
    localPath: string,
    originalDimensions: { width: number; height: number }
  ): Promise<{ imagePath: string; cleanup: () => Promise<void> }> {
    const maxDim = Math.max(originalDimensions.width, originalDimensions.height);
    
    // No resize needed if already small enough
    if (maxDim <= this.MAX_IMAGE_DIMENSION_FOR_AI) {
      logger.debug('asset-processing.resize-skipped', {
        localPath,
        dimensions: originalDimensions,
        reason: 'Already within size limit'
      });
      return {
        imagePath: path.join(this.appPath, localPath),
        cleanup: async () => {} // No-op cleanup
      };
    }

    try {
      const originalPath = path.join(this.appPath, localPath);
      const tempPath = originalPath.replace(/(\.\w+)$/, '.ai-temp$1');
      
      // Resize maintaining aspect ratio
      await sharp(originalPath)
        .resize(this.MAX_IMAGE_DIMENSION_FOR_AI, this.MAX_IMAGE_DIMENSION_FOR_AI, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .toFile(tempPath);

      const resizedBuffer = await readFile(tempPath);
      const resizedDimensions = await this.getImageDimensionsFromBuffer(Buffer.from(resizedBuffer));
      
      logger.info('asset-processing.image-resized', {
        localPath,
        originalDimensions,
        resizedDimensions,
        originalSize: (await readFile(originalPath)).length,
        resizedSize: resizedBuffer.length,
        savingsPercent: Math.round((1 - resizedBuffer.length / (await readFile(originalPath)).length) * 100)
      });

      return {
        imagePath: tempPath,
        cleanup: async () => {
          try {
            await unlink(tempPath);
            logger.debug('asset-processing.temp-file-deleted', { tempPath });
          } catch (error) {
            logger.warn('asset-processing.temp-file-cleanup-failed', {
              tempPath,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      };
    } catch (error) {
      logger.warn('asset-processing.resize-failed', {
        localPath,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Fallback to original image
      return {
        imagePath: path.join(this.appPath, localPath),
        cleanup: async () => {}
      };
    }
  }

  /**
   * Get image dimensions from buffer (helper for resized images)
   * 
   * @param buffer - Image buffer
   * @returns Promise resolving to dimensions or null
   */
  private async getImageDimensionsFromBuffer(buffer: Buffer): Promise<{ width: number; height: number } | null> {
    try {
      const metadata = await sharp(buffer).metadata();
      if (metadata.width && metadata.height) {
        return { width: metadata.width, height: metadata.height };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get file extension from URL
   * 
   * @param url - Asset URL
   * @returns File extension or null
   */
  private getExtensionFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const match = pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|woff|woff2|ttf|otf|ico)$/i);
      return match && match[1] ? `.${match[1].toLowerCase()}` : null;
    } catch {
      return null;
    }
  }

  /**
   * Get file extension from asset type
   * 
   * @param type - Asset type
   * @returns File extension
   */
  private getExtensionFromType(type: string): string {
    switch (type) {
      case 'image':
        return '.jpg';
      case 'font':
        return '.woff2';
      case 'icon':
        return '.svg';
      default:
        return '.bin';
    }
  }

  /**
   * Ensure asset directories exist
   */
  private async ensureDirectories(): Promise<void> {
    await mkdir(path.join(this.assetsDir, 'images'), { recursive: true });
    await mkdir(path.join(this.assetsDir, 'other'), { recursive: true });
  }

  /**
   * Save asset manifest to disk
   * 
   * @param manifest - Asset manifest
   */
  private async saveManifest(manifest: AssetManifest): Promise<void> {
    const manifestPath = path.join(this.assetsDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    logger.info('asset-processing.manifest-saved', {
      path: manifestPath,
      totalAssets: manifest.totalAssets
    });
  }

  /**
   * Create images.md file listing all assets
   * 
   * @param assets - Processed assets
   */
  private async createImagesMarkdown(assets: AssetInfo[]): Promise<void> {
    try {
      const images = assets.filter(a => a.type === 'image');

      if (images.length === 0) {
        logger.info('asset-processing.no-images', {
          message: 'No images to create markdown for'
        });
        return;
      }

      let markdown = '# Source Website Images\n\n';
      markdown += `This file lists all ${images.length} images extracted from the source website.\n\n`;
      markdown += '## Images\n\n';

      for (const image of images) {
        const publicPath = normalizeAssetPath(image.localPath);

        markdown += `### ${path.basename(image.localPath)}\n\n`;
        markdown += `**Original URL:** ${image.url}\n\n`;
        
        if (image.description) {
          markdown += `**Description:** ${image.description}\n\n`;
        }
        
        if (image.dimensions) {
          markdown += `**Dimensions:** ${image.dimensions.width} × ${image.dimensions.height} px`;
          if (image.dimensions.width > image.dimensions.height) {
            markdown += ` (landscape)`;
          } else if (image.dimensions.height > image.dimensions.width) {
            markdown += ` (portrait)`;
          } else {
            markdown += ` (square)`;
          }
          markdown += '\n\n';
        }
        
        if (image.fileSize) {
          const sizeKB = (image.fileSize / 1024).toFixed(1);
          markdown += `**File Size:** ${sizeKB} KB\n\n`;
        }
        
        if (image.altText) {
          markdown += `**Alt Text:** ${image.altText}\n\n`;
        }
        
        if (image.usageContext) {
          markdown += `**Usage Context:** ${image.usageContext}\n\n`;
        }
        
        if (image.sourcePages && image.sourcePages.length > 0) {
          markdown += `**Used on pages:**\n`;
          for (const page of image.sourcePages) {
            markdown += `- ${page}\n`;
          }
          markdown += '\n';
        }

        markdown += `**Public Path:** \`${publicPath}\`\n\n`;
        markdown += `![${image.altText || 'Image'}](${publicPath})\n\n`;
        markdown += '---\n\n';
      }

      const markdownPath = path.join(this.appPath, '.source-site', 'images.md');
      await writeFile(markdownPath, markdown, 'utf-8');

      logger.info('asset-processing.images-markdown-created', {
        path: markdownPath,
        imageCount: images.length
      });
    } catch (error) {
      logger.error('asset-processing.images-markdown-error', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Analyze assets used on a specific page (lazy analysis)
   *
   * Filters assets by the page URL they were found on during scraping,
   * then generates AI descriptions only for those that don't have them yet.
   *
   * @param pageUrl - URL of the page being built
   * @param assetManifest - Full asset manifest
   * @returns Promise resolving to the assets on this page and the number of
   *   images that received new AI descriptions in this call
   */
  async analyzePageAssets(
    pageUrl: string,
    assetManifest: AssetManifest
  ): Promise<{ pageAssets: AssetInfo[]; analyzedImageCount: number }> {
    try {
      logger.info('asset-processing.analyze-page-assets.begin', {
        pageUrl,
        totalAssets: assetManifest.assets.length,
        sampleAssetSourcePages: assetManifest.assets.slice(0, 3).map(a => ({
          url: a.url,
          sourcePages: a.sourcePages
        }))
      });

      // Normalize both sides with the same helper the scrape-pipeline uses to
      // bucket assets, so a trailing-slash/query skew between pageContent.url
      // and Atlas's recorded sourcePages doesn't silently drop a page's images.
      const normalizedPageKey = normalizeRebuildPageKey(pageUrl);
      const pageAssets = assetManifest.assets.filter(asset =>
        asset.sourcePages?.some(sp => normalizeRebuildPageKey(sp) === normalizedPageKey)
      );

      logger.info('asset-processing.page-assets-filtered', {
        pageUrl,
        pageAssets: pageAssets.length,
        matchedAssets: pageAssets.slice(0, 5).map(a => a.url)
      });

      const unanalyzedImages = pageAssets.filter(
        asset => asset.type === 'image' && !asset.description
      );

      logger.info('asset-processing.unanalyzed-images', {
        pageUrl,
        pageAssets: pageAssets.length,
        unanalyzedImages: unanalyzedImages.length
      });

      const toAnalyze = unanalyzedImages.slice(0, this.MAX_IMAGES_TO_DESCRIBE);

      if (toAnalyze.length > 0) {
        if (unanalyzedImages.length > this.MAX_IMAGES_TO_DESCRIBE) {
          logger.info('asset-processing.image-cap-applied', {
            pageUrl,
            total: unanalyzedImages.length,
            capped: this.MAX_IMAGES_TO_DESCRIBE,
            dropped: unanalyzedImages.length - this.MAX_IMAGES_TO_DESCRIBE,
          });
        }
        await this.analyzeImageBatch(toAnalyze);

        await this.saveManifest(assetManifest);

        logger.info('asset-processing.manifest-updated-after-analysis', {
          pageUrl,
          imagesAnalyzed: toAnalyze.length,
        });
      }

      return { pageAssets, analyzedImageCount: toAnalyze.length };
    } catch (error) {
      logger.error('asset-processing.analyze-page-assets.error', {
        pageUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return { pageAssets: [], analyzedImageCount: 0 };
    }
  }

  /**
   * Extract asset URLs from HTML content
   */
  private extractAssetUrlsFromHtml(html: string): string[] {
    const urls = new Set<string>();

    // Extract from img src
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      if (match[1]) urls.add(match[1]);
    }

    // Extract from CSS background-image
    const bgRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/gi;
    while ((match = bgRegex.exec(html)) !== null) {
      if (match[1]) urls.add(match[1]);
    }

    // Extract from picture/source srcset
    const srcsetRegex = /srcset=["']([^"']+)["']/gi;
    while ((match = srcsetRegex.exec(html)) !== null) {
      if (match[1]) {
        // srcset can have multiple URLs
        const srcsetUrls = match[1].split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
        srcsetUrls.forEach(url => url && urls.add(url));
      }
    }

    return Array.from(urls);
  }

  /**
   * Analyze a batch of images with concurrency control
   */
  private async analyzeImageBatch(images: AssetInfo[]): Promise<void> {
    const BATCH_SIZE = 3; // Process 3 images at a time
    
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE);
      
      await Promise.all(
        batch.map(async (image) => {
          const description = await this.generateImageDescription(
            image.localPath,
            image.altText,
            image.dimensions
          );
          
          if (description) {
            image.description = description.description;
            image.composition = description.composition;
            image.usageContext = description.usageContext;
            image.hasEmbeddedText = description.hasEmbeddedText;
            image.embeddedText = description.embeddedText;

            logger.info('asset-processing.image-analyzed', {
              url: image.url,
              description: description.description.substring(0, 50),
              composition: description.composition,
              usageContext: description.usageContext,
              hasEmbeddedText: description.hasEmbeddedText
            });
          }
        })
      );
    }

    logger.info('asset-processing.batch-analysis-complete', {
      imagesAnalyzed: images.length
    });
  }
}

/** Result of the Haiku vision scan run on each downloaded image. */
export interface ImageDescriptionResult {
  description: string;
  composition: string;
  usageContext: string;
  /** Image has heading/brand text burned into its pixels. */
  hasEmbeddedText: boolean;
  /** Transcription of the embedded text, when {@link hasEmbeddedText} is true. */
  embeddedText: string | null;
}

/** Infer usage context from alt text when the vision scan yields no JSON. */
function inferUsageContext(altText: string): string {
  const lower = altText.toLowerCase();

  if (lower.includes('hero') || lower.includes('banner')) return 'hero';
  if (lower.includes('icon') || lower.includes('logo')) return 'icon';
  if (lower.includes('background')) return 'background';
  if (lower.includes('product') || lower.includes('item')) return 'product';
  if (lower.includes('team') || lower.includes('person') || lower.includes('profile')) return 'profile';

  return 'general';
}

/** Fallback description used when the vision scan errors or returns no JSON. */
function fallbackImageDescription(existingAlt?: string): ImageDescriptionResult {
  return {
    description: existingAlt || 'Image from source website',
    composition: 'unknown',
    usageContext: existingAlt ? inferUsageContext(existingAlt) : 'general',
    hasEmbeddedText: false,
    embeddedText: null,
  };
}

/**
 * Parse the JSON object extracted from a Haiku vision-scan response into an
 * {@link ImageDescriptionResult}.
 *
 * Pure so the field coercion logic is unit-testable without mocking the ai-lib
 * agent factory. `jsonText` is the `{...}` substring the caller matched out of
 * the model response (undefined when none was found). Returns `null` when
 * `jsonText` is absent or malformed so the caller can log the miss and apply
 * its own fallback — a `null` is the signal that the model misbehaved.
 */
export function parseImageDescriptionResponse(
  jsonText: string | undefined,
  existingAlt?: string,
): ImageDescriptionResult | null {
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    const hasEmbeddedText = parsed.hasEmbeddedText === true;
    return {
      // Coerce description: a valid JSON object that omits it must not yield an
      // undefined `description` (the type promises a string, and callers call
      // .substring on it).
      description: parsed.description || existingAlt || 'Image from source website',
      composition: parsed.composition || 'unknown',
      // Coerce like its siblings: the type promises a string, and a valid JSON
      // object can omit usageContext. Mirrors fallbackImageDescription's default.
      usageContext: parsed.usageContext || 'general',
      hasEmbeddedText,
      embeddedText: hasEmbeddedText ? (parsed.embeddedText || null) : null,
    };
  } catch {
    // Malformed JSON — signal the miss to the caller.
    return null;
  }
}

/**
 * Image-CDN transform query params that select a *variant* of one source image
 * rather than a different image. Stripped when computing the dedup key so e.g.
 * Squarespace `?format=100w`, `?format=original`, and the bare URL all collapse —
 * while identity params (`id`, `v`, signed-CDN tokens) are preserved so two
 * genuinely different images served from one path are NOT merged.
 */
const IMAGE_VARIANT_QUERY_PARAMS = new Set([
  'format', 'w', 'h', 'width', 'height', 'quality', 'q', 'dpr', 'fit', 'auto', 'fm',
]);

/**
 * Collapse image variants that point at the same source file.
 *
 * AIROBUILD-2103: some image CDNs expose one source image as many URLs that
 * differ only by transform query params — Squarespace's `?format=Nw` /
 * `?format=original` / bare being the case this targets. Atlas normalizes most,
 * but residual variants (e.g. a bare `<img src>` vs. its `?format=original`
 * srcset sibling) can still reach the manifest as look-alike duplicates, which
 * the rebuild prompt forwards to the LLM (and it fabricates galleries from the
 * apparent multiplicity). Defense-in-depth net on top of Atlas normalization:
 * group images by origin + pathname + any *non-variant* query params, keep the
 * highest-fidelity entry, and union their `sourcePages`. Non-image assets are
 * never collapsed.
 *
 * Only query-param variants are collapsed. Wix-style transforms live in the URL
 * *path* (`/v1/fill/w_500,.../x.jpg`), so different Wix variants have different
 * pathnames and are left to Atlas's upstream path normalization.
 */
export function dedupeImageVariants(assets: AssetInfo[]): AssetInfo[] {
  const canonicalKey = (a: AssetInfo): string => {
    if (a.type !== 'image') return `exact:${a.url}`;
    try {
      const u = new URL(a.url);
      // Drop known transform params; keep identity params so distinct images
      // sharing a path (`?id=1` vs `?id=2`) stay separate rather than collapsing
      // and mis-merging their sourcePages.
      const kept = [...u.searchParams.entries()]
        .filter(([k]) => !IMAGE_VARIANT_QUERY_PARAMS.has(k.toLowerCase()))
        .sort(([x], [y]) => x.localeCompare(y));
      const query = kept.map(([k, v]) => `${k}=${v}`).join('&');
      return `${u.origin}${u.pathname}${query ? `?${query}` : ''}`;
    } catch {
      return `exact:${a.url}`;
    }
  };
  const width = (a: AssetInfo): number => a.dimensions?.width ?? 0;
  const isOriginal = (a: AssetInfo): boolean => /[?&]format=original/.test(a.url);
  const union = (a: string[] | undefined, b: string[] | undefined): string[] =>
    [...new Set([...(a ?? []), ...(b ?? [])])];

  // Pick the full-res source: an explicit `?format=original` wins outright (its
  // recorded width is often absent, so a sized thumbnail must not outrank it);
  // otherwise the larger recorded width; otherwise keep the first seen.
  const preferred = (a: AssetInfo, b: AssetInfo): AssetInfo => {
    if (isOriginal(a) !== isOriginal(b)) return isOriginal(a) ? a : b;
    return width(a) >= width(b) ? a : b;
  };

  const byKey = new Map<string, AssetInfo>();
  for (const asset of assets) {
    const key = canonicalKey(asset);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, asset);
      continue;
    }
    const keep = preferred(existing, asset);
    const drop = keep === existing ? asset : existing;
    // Carry over content-descriptive fields from the dropped variant when the
    // kept one lacks them, so a prior analysis isn't discarded and re-run
    // (mirrors the backfill process() does). These describe the image content
    // and are resolution-independent. Deliberately NOT dimensions/fileSize: the
    // dropped variant is a different resolution, so copying its size onto the
    // kept (higher-res/original) entry would misreport it.
    byKey.set(key, {
      ...keep,
      sourcePages: union(keep.sourcePages, drop.sourcePages),
      ...(!keep.description && drop.description ? { description: drop.description } : {}),
      ...(!keep.altText && drop.altText ? { altText: drop.altText } : {}),
      ...(!keep.usageContext && drop.usageContext ? { usageContext: drop.usageContext } : {}),
      ...(!keep.composition && drop.composition ? { composition: drop.composition } : {}),
      // Backfill embedded-text only from a dropped variant when the kept one
      // has no value yet. In today's flow dedup runs before vision analysis, so
      // both are undefined here; the guard also protects an already-analyzed
      // `false` from a disagreeing variant if the order ever changes.
      ...(keep.hasEmbeddedText === undefined && drop.hasEmbeddedText
        ? { hasEmbeddedText: true, embeddedText: drop.embeddedText ?? null }
        : {}),
    });
  }
  return [...byKey.values()];
}

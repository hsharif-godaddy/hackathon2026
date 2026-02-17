// agents/src/services/ImageProcessingService.ts
import sharp from "sharp";
import { logger } from "../logging/index.js";

export interface ProcessImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  minWidth?: number;
  minHeight?: number;
  quality?: number;
  format?: "jpeg" | "png" | "webp";
}

export interface ProcessImageResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
  originalWidth: number;
  originalHeight: number;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_MIN_DIMENSION = 50;
const DEFAULT_QUALITY = 85;

export class ImageProcessingService {
  validateImageType(mimeType: string): boolean {
    return ALLOWED_IMAGE_TYPES.has(mimeType);
  }

  async processImage(buffer: Buffer, options: ProcessImageOptions = {}): Promise<ProcessImageResult> {
    const {
      maxWidth = DEFAULT_MAX_DIMENSION,
      maxHeight = DEFAULT_MAX_DIMENSION,
      minWidth = DEFAULT_MIN_DIMENSION,
      minHeight = DEFAULT_MIN_DIMENSION,
      quality = DEFAULT_QUALITY,
      format,
    } = options;

    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    if (originalWidth < minWidth || originalHeight < minHeight) {
      throw new Error(`Image must be at least ${minWidth}x${minHeight} pixels`);
    }

    let outputFormat = format;
    if (!outputFormat) {
      if (metadata.format && ["jpeg", "png", "webp"].includes(metadata.format)) {
        outputFormat = metadata.format as "jpeg" | "png" | "webp";
      } else {
        outputFormat = "jpeg";
      }
    }

    // rotate() auto-rotates based on EXIF orientation, then sharp strips all metadata by default
    // (EXIF, GPS coordinates, camera info, etc.) - this is the secure default behavior
    let pipeline = sharp(buffer).rotate();

    if (originalWidth > maxWidth || originalHeight > maxHeight) {
      pipeline = pipeline.resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true });
    }

    switch (outputFormat) {
      case "jpeg":
        // progressive: true enables progressive JPEG for better loading UX on slow connections
        pipeline = pipeline.jpeg({ quality, mozjpeg: true, progressive: true });
        break;
      case "png":
        pipeline = pipeline.png({ compressionLevel: 9 });
        break;
      case "webp":
        pipeline = pipeline.webp({ quality });
        break;
    }

    const outputBuffer = await pipeline.toBuffer();
    const outputMetadata = await sharp(outputBuffer).metadata();

    logger.debug("image_processing.complete", {
      originalWidth, originalHeight,
      outputWidth: outputMetadata.width, outputHeight: outputMetadata.height,
      originalSize: buffer.length, outputSize: outputBuffer.length,
      format: outputFormat,
    });

    return {
      buffer: outputBuffer,
      width: outputMetadata.width || 0,
      height: outputMetadata.height || 0,
      format: outputFormat,
      originalWidth,
      originalHeight,
    };
  }
}

export const imageProcessingService = new ImageProcessingService();

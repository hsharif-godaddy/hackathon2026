// agents/src/services/ImageProcessingService.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { ImageProcessingService } from "./ImageProcessingService.js";

describe("ImageProcessingService", () => {
  let service: ImageProcessingService;

  beforeAll(() => {
    service = new ImageProcessingService();
  });

  describe("processImage", () => {
    it("should resize image larger than max dimensions", async () => {
      const sharp = (await import("sharp")).default;
      const largeImage = await sharp({
        create: { width: 3000, height: 2000, channels: 3, background: { r: 255, g: 0, b: 0 } },
      }).jpeg().toBuffer();

      const result = await service.processImage(largeImage, { maxWidth: 2048, maxHeight: 2048 });

      expect(result.width).toBeLessThanOrEqual(2048);
      expect(result.height).toBeLessThanOrEqual(2048);
      expect(result.width / result.height).toBeCloseTo(3 / 2, 1);
    });

    it("should not resize image smaller than max dimensions", async () => {
      const sharp = (await import("sharp")).default;
      const smallImage = await sharp({
        create: { width: 800, height: 600, channels: 3, background: { r: 0, g: 255, b: 0 } },
      }).jpeg().toBuffer();

      const result = await service.processImage(smallImage, { maxWidth: 2048, maxHeight: 2048 });

      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it("should strip EXIF metadata", async () => {
      const sharp = (await import("sharp")).default;
      const imageWithMeta = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
      }).jpeg().toBuffer();

      const result = await service.processImage(imageWithMeta, {});

      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.exif).toBeUndefined();
    });

    it("should compress with quality setting", async () => {
      const sharp = (await import("sharp")).default;
      const image = await sharp({
        create: { width: 1000, height: 1000, channels: 3, background: { r: 128, g: 128, b: 128 } },
      }).jpeg({ quality: 100 }).toBuffer();

      const result = await service.processImage(image, { quality: 60 });

      expect(result.buffer.length).toBeLessThan(image.length);
    });

    it("should reject images smaller than minimum dimensions", async () => {
      const sharp = (await import("sharp")).default;
      const tinyImage = await sharp({
        create: { width: 30, height: 30, channels: 3, background: { r: 255, g: 255, b: 255 } },
      }).jpeg().toBuffer();

      await expect(
        service.processImage(tinyImage, { minWidth: 50, minHeight: 50 }),
      ).rejects.toThrow("Image must be at least 50x50 pixels");
    });
  });

  describe("validateImageType", () => {
    it("should accept valid image MIME types", () => {
      expect(service.validateImageType("image/jpeg")).toBe(true);
      expect(service.validateImageType("image/png")).toBe(true);
      expect(service.validateImageType("image/webp")).toBe(true);
      expect(service.validateImageType("image/gif")).toBe(true);
    });

    it("should reject invalid MIME types", () => {
      expect(service.validateImageType("image/svg+xml")).toBe(false);
      expect(service.validateImageType("application/pdf")).toBe(false);
      expect(service.validateImageType("text/html")).toBe(false);
    });
  });
});

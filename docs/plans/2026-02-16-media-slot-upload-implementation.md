---
status: implemented
---

# Media Slot Image Upload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to upload their own images to media slots, with image processing and integration into the existing media slot system.

**Architecture:** New upload endpoint in agents service handles image validation, processing (resize/optimize via sharp), and storage to `/public/media/`. Dev-supervisor proxy serves uploaded files directly from disk. MediaSlotDialog gets upload button UI.

**Tech Stack:** TypeScript (agents + app), Go (dev-supervisor), sharp (image processing), multer (file upload), React (UI)

---

## Task 1: Create ImageProcessingService

**Files:**

- Create: `agents/src/services/ImageProcessingService.ts`
- Create: `agents/src/services/ImageProcessingService.test.ts`

**Step 1: Write the failing test**

```typescript
// agents/src/services/ImageProcessingService.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { ImageProcessingService } from "./ImageProcessingService.js";
import * as fs from "fs/promises";
import * as path from "path";

describe("ImageProcessingService", () => {
  let service: ImageProcessingService;

  beforeAll(() => {
    service = new ImageProcessingService();
  });

  describe("processImage", () => {
    it("should resize image larger than max dimensions", async () => {
      // Create a 3000x2000 test image buffer using sharp
      const sharp = (await import("sharp")).default;
      const largeImage = await sharp({
        create: {
          width: 3000,
          height: 2000,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await service.processImage(largeImage, {
        maxWidth: 2048,
        maxHeight: 2048,
      });

      expect(result.width).toBeLessThanOrEqual(2048);
      expect(result.height).toBeLessThanOrEqual(2048);
      // Should preserve aspect ratio (3:2)
      expect(result.width / result.height).toBeCloseTo(3 / 2, 1);
    });

    it("should not resize image smaller than max dimensions", async () => {
      const sharp = (await import("sharp")).default;
      const smallImage = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 0, g: 255, b: 0 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await service.processImage(smallImage, {
        maxWidth: 2048,
        maxHeight: 2048,
      });

      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it("should strip EXIF metadata", async () => {
      const sharp = (await import("sharp")).default;
      // Create image with metadata
      const imageWithMeta = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 0, g: 0, b: 255 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await service.processImage(imageWithMeta, {});

      // Parse result and check for no EXIF
      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.exif).toBeUndefined();
    });

    it("should compress with quality setting", async () => {
      const sharp = (await import("sharp")).default;
      const image = await sharp({
        create: {
          width: 1000,
          height: 1000,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
        },
      })
        .jpeg({ quality: 100 })
        .toBuffer();

      const result = await service.processImage(image, { quality: 60 });

      // Compressed should be smaller than original
      expect(result.buffer.length).toBeLessThan(image.length);
    });

    it("should reject images smaller than minimum dimensions", async () => {
      const sharp = (await import("sharp")).default;
      const tinyImage = await sharp({
        create: {
          width: 30,
          height: 30,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .jpeg()
        .toBuffer();

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
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit -- "ImageProcessingService"`
Expected: FAIL with "Cannot find module './ImageProcessingService.js'"

**Step 3: Write minimal implementation**

```typescript
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

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_MIN_DIMENSION = 50;
const DEFAULT_QUALITY = 85;

export class ImageProcessingService {
  /**
   * Validate if MIME type is an allowed image type
   */
  validateImageType(mimeType: string): boolean {
    return ALLOWED_IMAGE_TYPES.has(mimeType);
  }

  /**
   * Process an image buffer: resize if needed, compress, strip metadata
   */
  async processImage(
    buffer: Buffer,
    options: ProcessImageOptions = {},
  ): Promise<ProcessImageResult> {
    const {
      maxWidth = DEFAULT_MAX_DIMENSION,
      maxHeight = DEFAULT_MAX_DIMENSION,
      minWidth = DEFAULT_MIN_DIMENSION,
      minHeight = DEFAULT_MIN_DIMENSION,
      quality = DEFAULT_QUALITY,
      format,
    } = options;

    // Get original metadata
    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    // Validate minimum dimensions
    if (originalWidth < minWidth || originalHeight < minHeight) {
      throw new Error(`Image must be at least ${minWidth}x${minHeight} pixels`);
    }

    // Determine output format
    let outputFormat = format;
    if (!outputFormat) {
      // Preserve original format if supported, otherwise convert to jpeg
      if (
        metadata.format &&
        ["jpeg", "png", "webp"].includes(metadata.format)
      ) {
        outputFormat = metadata.format as "jpeg" | "png" | "webp";
      } else {
        outputFormat = "jpeg";
      }
    }

    // Build sharp pipeline
    let pipeline = sharp(buffer).rotate(); // Auto-rotate based on EXIF orientation

    // Resize if larger than max dimensions (preserves aspect ratio)
    if (originalWidth > maxWidth || originalHeight > maxHeight) {
      pipeline = pipeline.resize(maxWidth, maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // Apply format-specific options and strip metadata
    switch (outputFormat) {
      case "jpeg":
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
        break;
      case "png":
        pipeline = pipeline.png({ compressionLevel: 9 });
        break;
      case "webp":
        pipeline = pipeline.webp({ quality });
        break;
    }

    // Process and get result
    const outputBuffer = await pipeline.toBuffer();
    const outputMetadata = await sharp(outputBuffer).metadata();

    logger.debug("image_processing.complete", {
      originalWidth,
      originalHeight,
      outputWidth: outputMetadata.width,
      outputHeight: outputMetadata.height,
      originalSize: buffer.length,
      outputSize: outputBuffer.length,
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit -- "ImageProcessingService"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/services/ImageProcessingService.ts agents/src/services/ImageProcessingService.test.ts
git commit -m "feat(agents): add ImageProcessingService for media slot uploads"
```

---

## Task 2: Add Media Upload Endpoint

**Files:**

- Modify: `agents/src/server/routes/media.ts`
- Create: `agents/src/server/routes/__tests__/media-upload.test.ts`

**Step 1: Write the failing test**

```typescript
// agents/src/server/routes/__tests__/media-upload.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import { Router } from "express";
import multer from "multer";
import sharp from "sharp";

// Mock dependencies
vi.mock("../../../services/MediaManifestService.js", () => ({
  mediaManifestService: {
    getSlot: vi.fn(),
    updateSlotWithUpload: vi.fn(),
  },
}));

vi.mock("../../../database/repositories/AppRepository.js", () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi
      .fn()
      .mockReturnValue({ id: "test-app", path: "/tmp/test-app" }),
  })),
}));

describe("POST /media/:appId/slots/:slotName/upload", () => {
  let app: express.Application;

  beforeAll(async () => {
    // Import after mocks are set up
    const { default: mediaRouter } = await import("../media.js");
    app = express();
    app.use("/media", mediaRouter);
  });

  it("should reject non-image files", async () => {
    const response = await request(app)
      .post("/media/test-app/slots/hero/upload")
      .attach("image", Buffer.from("not an image"), {
        filename: "test.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain(
      "Only JPEG, PNG, WebP, and GIF images are supported",
    );
  });

  it("should reject files larger than 10MB", async () => {
    // Create a buffer larger than 10MB
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024);

    const response = await request(app)
      .post("/media/test-app/slots/hero/upload")
      .attach("image", largeBuffer, {
        filename: "large.jpg",
        contentType: "image/jpeg",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("10MB");
  });

  it("should accept valid image upload", async () => {
    const { mediaManifestService } = await import(
      "../../../services/MediaManifestService.js"
    );
    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: {
        mediaType: "image",
        currentUrl: "https://media.gettyimages.com/old.jpg",
        searchQuery: "hero image",
        alternatives: [],
        userModified: false,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    });
    vi.mocked(mediaManifestService.updateSlotWithUpload).mockResolvedValue({
      success: true,
      slot: {
        mediaType: "image",
        currentUrl: "/airo-assets/uploads/hero-abc123.jpg",
        searchQuery: "hero image",
        alternatives: ["https://media.gettyimages.com/old.jpg"],
        userModified: true,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    });

    // Create a valid test image
    const testImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const response = await request(app)
      .post("/media/test-app/slots/hero/upload")
      .attach("image", testImage, {
        filename: "test.jpg",
        contentType: "image/jpeg",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.uploadedUrl).toContain("/airo-assets/uploads/");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit -- "media-upload"`
Expected: FAIL

**Step 3: Write implementation**

Add to `agents/src/server/routes/media.ts`:

```typescript
// Add imports at top of file
import multer from "multer";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import { imageProcessingService } from "../../services/ImageProcessingService.js";

// Add multer configuration after existing imports
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// Rate limiter for uploads (reuse pattern from files.ts)
const uploadRateLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 20,
  message: "Too many upload requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /media/:appId/slots/:slotName/upload
 * Upload an image to a media slot
 */
router.post(
  "/:appId/slots/:slotName(*)/upload",
  uploadRateLimiter,
  upload.single("image"),
  async (req: Request, res: Response) => {
    try {
      const appId = req.params.appId;
      const slotName = req.params.slotName;

      if (!appId || !slotName) {
        return res.status(400).json({
          success: false,
          error: "App ID and slot name are required",
        });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          error: "No image file provided",
        });
      }

      // Validate image type
      if (!imageProcessingService.validateImageType(file.mimetype)) {
        return res.status(400).json({
          success: false,
          error: "Only JPEG, PNG, WebP, and GIF images are supported",
        });
      }

      logger.info("route.media.upload.start", {
        appId,
        slotName,
        size: file.size,
      });

      // Get the existing slot to verify it exists
      const slotResult = await mediaManifestService.getSlot(appId, slotName);
      if (!slotResult.success) {
        return res.status(404).json({
          success: false,
          error: `Slot not found: ${slotName}`,
        });
      }

      // Get app path for storage
      const appRepository = new AppRepository();
      const app = appRepository.findById(appId);
      if (!app) {
        return res.status(404).json({
          success: false,
          error: `App not found: ${appId}`,
        });
      }

      // Process the image (resize, optimize, strip metadata)
      const processed = await imageProcessingService.processImage(file.buffer, {
        maxWidth: 2048,
        maxHeight: 2048,
        quality: 85,
      });

      // Generate filename: {sanitized-slot}-{hash}.{ext}
      const sanitizedSlot = slotName
        .replace(/\//g, "-")
        .replace(/[^a-zA-Z0-9-]/g, "");
      const hash = crypto
        .createHash("sha256")
        .update(processed.buffer)
        .digest("hex")
        .slice(0, 8);
      const ext = processed.format === "jpeg" ? "jpg" : processed.format;
      const filename = `${sanitizedSlot}-${hash}.${ext}`;

      // Ensure /public/media/ directory exists
      const mediaDir = path.join(app.path, "public", "media");
      await fs.mkdir(mediaDir, { recursive: true });

      // Write file to disk
      const filePath = path.join(mediaDir, filename);
      await fs.writeFile(filePath, processed.buffer);

      // Build the URL (using airo-assets proxy pattern)
      const uploadedUrl = `/airo-assets/uploads/${filename}`;

      // Update manifest: new URL becomes current, old current goes to alternatives
      const updateResult = await mediaManifestService.updateSlotWithUpload(
        appId,
        slotName,
        uploadedUrl,
      );

      if (!updateResult.success) {
        // Clean up the written file on failure
        await fs.unlink(filePath).catch(() => {});
        return res.status(500).json({
          success: false,
          error: updateResult.error || "Failed to update manifest",
        });
      }

      logger.info("route.media.upload.success", {
        appId,
        slotName,
        uploadedUrl,
        originalSize: file.size,
        processedSize: processed.buffer.length,
      });

      return res.json({
        success: true,
        uploadedUrl,
        slot: updateResult.slot,
      });
    } catch (error) {
      logger.error("route.media.upload.error", {
        appId: req.params.appId,
        slotName: req.params.slotName,
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        success: false,
        error: "Failed to upload image",
      });
    }
  },
);
```

**Step 4: Add updateSlotWithUpload to MediaManifestService**

Add to `agents/src/services/MediaManifestService.ts`:

```typescript
/**
 * Update a slot with an uploaded image URL
 * The uploaded URL becomes current, old current moves to alternatives
 */
async updateSlotWithUpload(
  appId: string,
  slotName: string,
  uploadedUrl: string
): Promise<ManifestOperationResult> {
  const app = this.appRepository.findById(appId)
  if (!app) {
    return {
      success: false,
      error: `App not found: ${appId}`
    }
  }

  const logContext = { appId, slotName, uploadedUrl }
  logger.info('media_manifest.upload_slot.begin', logContext)

  const releaseLock = await acquireLock(appId)

  try {
    const manifestPath = this.getManifestPath(app.path)

    // Read current manifest
    let manifest: MediaManifest = {}
    try {
      const content = await fs.readFile(manifestPath, 'utf-8')
      manifest = JSON.parse(content)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('media_manifest.upload_slot.read_error', {
          ...logContext,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      manifest = {}
    }

    // Get existing slot
    const existingSlot = manifest[slotName]
    if (!existingSlot) {
      return {
        success: false,
        error: `Slot not found: ${slotName}`
      }
    }

    // Move current URL to alternatives (if it's not already the uploaded URL)
    const newAlternatives = existingSlot.currentUrl !== uploadedUrl
      ? [existingSlot.currentUrl, ...existingSlot.alternatives]
      : existingSlot.alternatives

    // Update slot with uploaded URL as current
    const updatedSlot: MediaSlot = {
      ...existingSlot,
      currentUrl: uploadedUrl,
      alternatives: newAlternatives,
      userModified: true,
      lastUpdated: new Date().toISOString()
    }

    manifest[slotName] = updatedSlot

    // Write atomically
    const tempPath = `${manifestPath}.tmp`
    const content = JSON.stringify(manifest, null, 2)
    await fs.writeFile(tempPath, content, 'utf-8')
    await fs.rename(tempPath, manifestPath)

    // Commit to git
    let commitHash: string | undefined
    try {
      commitHash = await this.commitManifestChange(appId, slotName, 'update')
    } catch (gitError) {
      logger.warn('media_manifest.upload_slot.git_commit_failed', {
        ...logContext,
        error: gitError instanceof Error ? gitError.message : String(gitError)
      })
    }

    logger.info('media_manifest.upload_slot.success', {
      ...logContext,
      commitHash
    })

    return {
      success: true,
      slot: updatedSlot,
      manifest,
      commitHash
    }
  } finally {
    releaseLock()
  }
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit -- "media-upload"`
Expected: PASS

**Step 6: Commit**

```bash
git add agents/src/server/routes/media.ts agents/src/services/MediaManifestService.ts agents/src/server/routes/__tests__/media-upload.test.ts
git commit -m "feat(agents): add media slot upload endpoint"
```

---

## Task 3: Add Uploaded Media Proxy Handler (Go)

**Files:**

- Modify: `dev-supervisor/internal/proxy/http/image_slots.go`
- Modify: `dev-supervisor/internal/proxy/http/server.go`
- Create: `dev-supervisor/internal/proxy/http/uploaded_media.go`
- Create: `dev-supervisor/internal/proxy/http/uploaded_media_test.go`

**Step 1: Write the failing test**

```go
// dev-supervisor/internal/proxy/http/uploaded_media_test.go
package httpproxy

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestUploadedMediaHandler(t *testing.T) {
	// Create temp directory with test file
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "public", "media")
	if err := os.MkdirAll(mediaDir, 0755); err != nil {
		t.Fatalf("failed to create media dir: %v", err)
	}

	// Create test image file
	testFile := filepath.Join(mediaDir, "hero-abc123.jpg")
	if err := os.WriteFile(testFile, []byte("fake image data"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	handler := NewUploadedMediaHandler(tmpDir)

	t.Run("serves existing file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/hero-abc123.jpg", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", rec.Code)
		}
		if rec.Header().Get("Content-Type") != "image/jpeg" {
			t.Errorf("expected Content-Type image/jpeg, got %s", rec.Header().Get("Content-Type"))
		}
	})

	t.Run("returns 404 for missing file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/nonexistent.jpg", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", rec.Code)
		}
	})

	t.Run("blocks path traversal attempts", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/../../../etc/passwd", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", rec.Code)
		}
	})

	t.Run("only allows GET and HEAD", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/airo-assets/uploads/hero-abc123.jpg", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("expected status 405, got %d", rec.Code)
		}
	})
}
```

**Step 2: Run test to verify it fails**

Run: `cd dev-supervisor && go test -v ./internal/proxy/http -run TestUploadedMediaHandler`
Expected: FAIL

**Step 3: Write implementation**

```go
// dev-supervisor/internal/proxy/http/uploaded_media.go
package httpproxy

import (
	"encoding/json"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const uploadedMediaPrefix = "/airo-assets/uploads/"

// UploadedMediaHandler serves user-uploaded media files from /public/media/
type UploadedMediaHandler struct {
	appRoot string
}

// NewUploadedMediaHandler creates a new handler for serving uploaded media.
// appRoot is the base path where the app is located (e.g., /app).
func NewUploadedMediaHandler(appRoot string) *UploadedMediaHandler {
	return &UploadedMediaHandler{
		appRoot: appRoot,
	}
}

// ServeHTTP serves uploaded media files.
func (h *UploadedMediaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only GET and HEAD allowed
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract filename from path
	filename := strings.TrimPrefix(r.URL.Path, uploadedMediaPrefix)
	if filename == "" || filename == r.URL.Path {
		slog.Debug("uploaded_media.invalid_path", "url", r.URL.Path)
		h.respondError(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Security: Block path traversal attempts
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		slog.Warn("uploaded_media.path_traversal_attempt",
			"url", r.URL.Path,
			"filename", filename)
		h.respondError(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Build full path to file
	filePath := filepath.Join(h.appRoot, "public", "media", filename)

	// Clean the path and verify it's still under media directory
	cleanPath := filepath.Clean(filePath)
	mediaDir := filepath.Join(h.appRoot, "public", "media")
	if !strings.HasPrefix(cleanPath, mediaDir) {
		slog.Warn("uploaded_media.path_escape_attempt",
			"url", r.URL.Path,
			"resolved", cleanPath)
		h.respondError(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Check if file exists
	info, err := os.Stat(cleanPath)
	if os.IsNotExist(err) {
		slog.Debug("uploaded_media.not_found", "path", cleanPath)
		h.respondError(w, "file not found", http.StatusNotFound)
		return
	}
	if err != nil {
		slog.Error("uploaded_media.stat_error", "path", cleanPath, "error", err.Error())
		h.respondError(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Don't serve directories
	if info.IsDir() {
		h.respondError(w, "not a file", http.StatusBadRequest)
		return
	}

	// Determine content type from extension
	ext := filepath.Ext(filename)
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Set cache headers (1 year, immutable since filename includes hash)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	slog.Debug("uploaded_media.serve", "path", cleanPath, "contentType", contentType)

	// Serve the file
	http.ServeFile(w, r, cleanPath)
}

func (h *UploadedMediaHandler) respondError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
```

**Step 4: Register handler in server.go**

Add to `dev-supervisor/internal/proxy/http/server.go` in the Start() method, after the manifest cache setup:

```go
// After: manifestCache := NewManifestCache(manifestPath)

// Register uploaded media handler (serves /public/media/ files)
uploadedMediaHandler := NewUploadedMediaHandler(p.config.StaticRoot)
mux.Handle(uploadedMediaPrefix, uploadedMediaHandler)

slog.Info("uploaded_media.handler_registered",
	"prefix", uploadedMediaPrefix,
	"app_root", p.config.StaticRoot)
```

**Step 5: Run test to verify it passes**

Run: `cd dev-supervisor && go test -v ./internal/proxy/http -run TestUploadedMediaHandler`
Expected: PASS

**Step 6: Run linting and formatting**

Run: `cd dev-supervisor && make fmt-fix && make lint`
Expected: No errors

**Step 7: Commit**

```bash
git add dev-supervisor/internal/proxy/http/uploaded_media.go dev-supervisor/internal/proxy/http/uploaded_media_test.go dev-supervisor/internal/proxy/http/server.go
git commit -m "feat(dev-supervisor): add handler for serving uploaded media files"
```

---

## Task 4: Add Upload Button to MediaSlotDialog

**Files:**

- Modify: `app/src/components/media/MediaSlotDialog.tsx`
- Create: `app/src/components/media/MediaSlotDialog.test.tsx`

**Step 1: Write the failing test**

```typescript
// app/src/components/media/MediaSlotDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MediaSlotDialog } from './MediaSlotDialog'

// Mock the store
vi.mock('@/stores/useMediaSlotDialogStore', () => ({
  useMediaSlotDialogStore: vi.fn(() => ({
    isOpen: true,
    slotName: 'pages/home/hero',
    appId: 'test-app',
    closeDialog: vi.fn()
  }))
}))

// Mock the useMediaSlot hook
vi.mock('@/hooks/useMediaSlot', () => ({
  useMediaSlot: vi.fn(() => ({
    slot: {
      mediaType: 'image',
      currentUrl: 'https://media.gettyimages.com/current.jpg',
      alternatives: ['https://media.gettyimages.com/alt1.jpg'],
      searchQuery: 'hero image'
    },
    isLoading: false,
    error: null
  }))
}))

// Mock fetch
global.fetch = vi.fn()

describe('MediaSlotDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders upload button', () => {
    render(<MediaSlotDialog />)

    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
  })

  it('opens file picker when upload button clicked', async () => {
    render(<MediaSlotDialog />)

    const uploadButton = screen.getByRole('button', { name: /upload/i })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    expect(fileInput).toBeInTheDocument()
    expect(fileInput).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif')
  })

  it('shows loading state during upload', async () => {
    const user = userEvent.setup()

    // Mock slow response
    vi.mocked(global.fetch).mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        json: () => Promise.resolve({ success: true })
      } as Response), 100))
    )

    render(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    await user.upload(fileInput, file)

    // Should show uploading state
    await waitFor(() => {
      expect(screen.getByText(/uploading/i)).toBeInTheDocument()
    })
  })

  it('validates file type before upload', async () => {
    const user = userEvent.setup()
    render(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const invalidFile = new File(['test'], 'test.pdf', { type: 'application/pdf' })

    await user.upload(fileInput, invalidFile)

    // Should show error
    await waitFor(() => {
      expect(screen.getByText(/only.*images/i)).toBeInTheDocument()
    })

    // Should not call fetch
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('validates file size before upload', async () => {
    const user = userEvent.setup()
    render(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    // Create file larger than 10MB
    const largeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' })

    await user.upload(fileInput, largeFile)

    // Should show error
    await waitFor(() => {
      expect(screen.getByText(/10MB/i)).toBeInTheDocument()
    })

    // Should not call fetch
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter website test -- "MediaSlotDialog"`
Expected: FAIL (upload button not found)

**Step 3: Update MediaSlotDialog with upload functionality**

Add to `app/src/components/media/MediaSlotDialog.tsx`:

```tsx
// Add imports
import { Upload } from 'lucide-react'

// Add state inside MediaSlotDialog component (after existing state)
const [isUploading, setIsUploading] = useState(false)
const [uploadError, setUploadError] = useState<string | null>(null)
const fileInputRef = useRef<HTMLInputElement>(null)

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// Add upload handler
const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0]
  if (!file) return

  // Reset input for re-selection
  event.target.value = ''

  // Client-side validation
  if (!ALLOWED_TYPES.includes(file.type)) {
    setUploadError('Only JPEG, PNG, WebP, and GIF images are supported')
    return
  }

  if (file.size > MAX_FILE_SIZE) {
    setUploadError('Image exceeds 10MB limit')
    return
  }

  setUploadError(null)
  setIsUploading(true)

  try {
    const tokenResult = await regenerateToken({ siteId: appId, force: true })
    const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

    if (!apiConfig.agentUrl) {
      throw new Error('Agent URL not available')
    }

    const formData = new FormData()
    formData.append('image', file)

    const response = await fetch(
      `${apiConfig.agentUrl}/media/${appId}/slots/${slotName}/upload`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenResult.token}`
        },
        body: formData
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Upload failed' }))
      throw new Error(errorData.error || `Upload failed: ${response.status}`)
    }

    const result = await response.json()

    logger.info('media_slot_dialog.upload_success', {
      appId,
      slotName,
      uploadedUrl: result.uploadedUrl
    })

    // Reload the slot in the preview iframe
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (iframe) {
      postMessageToIframe(iframe, {
        type: 'RELOAD_MEDIA_SLOT',
        slotPath: slotName
      })
    }

    // Close dialog on success (slot data will refresh when reopened)
    closeDialog()
  } catch (error) {
    logger.error('media_slot_dialog.upload_failed', {
      appId,
      slotName,
      error: error instanceof Error ? error.message : String(error)
    })
    setUploadError(error instanceof Error ? error.message : 'Upload failed')
  } finally {
    setIsUploading(false)
  }
}, [appId, slotName, closeDialog])

// Add hidden file input (inside the component JSX, before the return's closing tag)
<input
  type="file"
  ref={fileInputRef}
  accept="image/jpeg,image/png,image/webp,image/gif"
  onChange={handleFileSelect}
  style={{ display: 'none' }}
/>

// Add upload button in the header area (next to "Use this image" button)
// For desktop layout, add in the flex container with the swap button:
<Button
  onClick={() => fileInputRef.current?.click()}
  design="secondary"
  icon={<Upload className={`w-4 h-4 ${isUploading ? 'animate-pulse' : ''}`} />}
  disabled={isUploading}
  className="flex-shrink-0"
>
  {isUploading ? 'Uploading...' : 'Upload'}
</Button>

// Add error display (after the buttons, in the header area)
{uploadError && (
  <p className="text-sm text-red-500 mt-2">{uploadError}</p>
)}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter website test -- "MediaSlotDialog"`
Expected: PASS

**Step 5: Commit**

```bash
git add app/src/components/media/MediaSlotDialog.tsx app/src/components/media/MediaSlotDialog.test.tsx
git commit -m "feat(app): add upload button to MediaSlotDialog"
```

---

## Task 5: Add Chat Uploads Section to MediaSlotDialog

**Files:**

- Modify: `app/src/components/media/MediaSlotDialog.tsx`
- Create: `app/src/components/media/UploadedImagesSection.tsx`

**Step 1: Write the component**

```tsx
// app/src/components/media/UploadedImagesSection.tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { agentFetch } from "@/lib/agent-fetch";
import { logger } from "@/lib/request-context";

interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
}

interface UploadedImagesSectionProps {
  appId: string;
  onSelectImage: (file: UploadedFile) => void;
  isDisabled?: boolean;
}

export function UploadedImagesSection({
  appId,
  onSelectImage,
  isDisabled,
}: UploadedImagesSectionProps) {
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUploads() {
      try {
        const response = await agentFetch(`/files/${appId}/list`);
        if (!response.ok) {
          throw new Error("Failed to fetch uploads");
        }
        const data = await response.json();

        // Filter to only image files
        const imageFiles = (data.files || []).filter((file: UploadedFile) =>
          file.mimeType?.startsWith("image/"),
        );

        setUploads(imageFiles);
      } catch (err) {
        logger.error("uploaded_images_section.fetch_failed", {
          appId,
          error: err instanceof Error ? err.message : String(err),
        });
        setError("Failed to load uploads");
      } finally {
        setIsLoading(false);
      }
    }

    fetchUploads();
  }, [appId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-intents-ux-textSubtle-textColor" />
      </div>
    );
  }

  if (error) {
    return null; // Silently hide on error
  }

  if (uploads.length === 0) {
    return null; // Don't show section if no uploads
  }

  return (
    <div className="mt-4 pt-4 border-t border-intents-ux-boxLowContrast-backgroundColor">
      <h4 className="text-sm font-medium mb-2 text-intents-ux-textSubtle-textColor">
        Your Uploads
      </h4>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {uploads.map((file) => (
          <button
            key={file.id}
            type="button"
            onClick={() => onSelectImage(file)}
            disabled={isDisabled}
            className={`flex-shrink-0 w-16 h-16 flex items-center justify-center rounded-md bg-intents-ux-boxLowContrast-backgroundColor hover:opacity-80 transition-opacity ${
              isDisabled ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${appId}/uploads/${file.filename}`}
              alt={file.originalName}
              className="max-w-full max-h-full object-contain rounded-md"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Integrate into MediaSlotDialog**

Add to MediaSlotDialog.tsx:

```tsx
// Import the component
import { UploadedImagesSection } from './UploadedImagesSection'

// Add handler for selecting from uploads
const handleSelectFromUploads = useCallback(async (file: { filename: string }) => {
  setIsUploading(true)
  setUploadError(null)

  try {
    // Fetch the file from uploads and re-upload to media slot
    const tokenResult = await regenerateToken({ siteId: appId, force: true })
    const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

    // First fetch the file
    const fileResponse = await fetch(
      `/api/files/${appId}/uploads/${file.filename}`,
      {
        headers: {
          'Authorization': `Bearer ${tokenResult.token}`
        }
      }
    )

    if (!fileResponse.ok) {
      throw new Error('Failed to fetch uploaded file')
    }

    const blob = await fileResponse.blob()
    const formData = new FormData()
    formData.append('image', blob, file.filename)

    // Upload to media slot
    const uploadResponse = await fetch(
      `${apiConfig.agentUrl}/media/${appId}/slots/${slotName}/upload`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenResult.token}`
        },
        body: formData
      }
    )

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json().catch(() => ({ error: 'Upload failed' }))
      throw new Error(errorData.error || 'Upload failed')
    }

    // Reload preview and close
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (iframe) {
      postMessageToIframe(iframe, {
        type: 'RELOAD_MEDIA_SLOT',
        slotPath: slotName
      })
    }

    closeDialog()
  } catch (error) {
    setUploadError(error instanceof Error ? error.message : 'Failed to use uploaded image')
  } finally {
    setIsUploading(false)
  }
}, [appId, slotName, closeDialog])

// Add the section in the dialog content (after the images grid)
<UploadedImagesSection
  appId={appId}
  onSelectImage={handleSelectFromUploads}
  isDisabled={isUploading}
/>
```

**Step 3: Run tests**

Run: `pnpm --filter website test -- "MediaSlotDialog"`
Expected: PASS

**Step 4: Commit**

```bash
git add app/src/components/media/UploadedImagesSection.tsx app/src/components/media/MediaSlotDialog.tsx
git commit -m "feat(app): add chat uploads section to MediaSlotDialog"
```

---

## Task 6: Integration Testing

**Files:**

- Manual testing checklist

**Step 1: Build and start services**

```bash
pnpm build
pnpm dev
```

**Step 2: Manual test checklist**

- [ ] Open MediaSlotDialog for any slot
- [ ] Click "Upload" button → file picker opens
- [ ] Upload a JPEG image → image becomes current, dialog closes
- [ ] Reopen dialog → uploaded image shown as current
- [ ] Upload PNG, WebP, GIF → all work
- [ ] Upload image > 2048px → verify it's resized
- [ ] Try uploading PDF → error message shown
- [ ] Try uploading > 10MB file → error message shown
- [ ] Upload via chat → image appears in "Your Uploads" section
- [ ] Click uploaded image in "Your Uploads" → it becomes current
- [ ] Preview iframe updates after upload
- [ ] Mobile layout: upload button in bottom action area
- [ ] Desktop layout: upload button in header row

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete media slot image upload implementation

- ImageProcessingService for resize/optimize
- Upload endpoint at POST /media/:appId/slots/:slotName/upload
- dev-supervisor handler for /airo-assets/uploads/
- Upload button in MediaSlotDialog
- Chat uploads integration"
```

---

## Summary

| Task | Description                   | Estimated Time |
| ---- | ----------------------------- | -------------- |
| 1    | ImageProcessingService        | 30 min         |
| 2    | Media Upload Endpoint         | 45 min         |
| 3    | Go Proxy Handler              | 30 min         |
| 4    | MediaSlotDialog Upload Button | 30 min         |
| 5    | Chat Uploads Section          | 20 min         |
| 6    | Integration Testing           | 30 min         |

**Total:** ~3 hours

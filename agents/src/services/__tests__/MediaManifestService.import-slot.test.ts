import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import type { MediaSlot } from "../MediaManifestService.js";

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock("../../database/repositories/AppRepository.js", () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi
      .fn()
      .mockReturnValue({ id: "test-app", path: "/tmp/test-app" }),
  })),
}));

vi.mock("../../utils/dev-supervisor-client-factory.js", () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn().mockReturnValue(null) },
}));

vi.mock("../../utils/git.js", () => ({
  GitUtils: vi.fn(),
}));

vi.mock("../../logging/index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../tools/ast-image-editor.js", () => ({
  astImageEditor: {
    replaceImage: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("../GettyUploadService.js", () => ({
  gettyUploadService: {
    uploadAndReport: vi.fn().mockResolvedValue([]),
    reportUsage: vi.fn(),
  },
}));

import { astImageEditor } from "../../tools/ast-image-editor.js";
import { MediaManifestService } from "../MediaManifestService.js";

describe("MediaManifestService - importSlot", () => {
  let service: MediaManifestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MediaManifestService();

    // Default: fs.access rejects (file not found) so local copy is skipped
    vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  });

  it("derives slot name from image alt text", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/photo.jpg",
      imageAlt: "A happy dog",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 82,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("pages/home/a-happy-dog");
  });

  it("derives slot name from image URL filename when no alt text", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/assets/hero-banner.jpg",
      devContext: {
        fileName: "src/pages/about.tsx",
        componentName: "unknown",
        lineNumber: 42,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("pages/about/hero-banner");
  });

  it("falls back to line number when no alt or meaningful filename", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "data:image/png;base64,abc123",
      devContext: {
        fileName: "src/pages/about.tsx",
        componentName: "unknown",
        lineNumber: 42,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("pages/about/image-42");
  });

  it("copies localhost image to public/media and stores as /airo-assets/uploads/ URL", async () => {
    const fakeImageBuffer = Buffer.from("fake-image-data");
    // First readFile: manifest. Second readFile: image file content.
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(JSON.stringify({}))      // manifest
      .mockResolvedValueOnce(fakeImageBuffer as any);  // image file
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    vi.mocked(fs.access).mockResolvedValue(undefined); // file exists
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);

    await service.importSlot("test-app", {
      imageUrl: "https://localhost:5009/assets/photo.jpg",
      imageAlt: "Test photo",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 10,
      },
    });

    // Should have checked the source file exists
    expect(fs.access).toHaveBeenCalledWith(
      "/tmp/test-app/public/assets/photo.jpg"
    );

    // Should have created public/media dir
    expect(fs.mkdir).toHaveBeenCalledWith(
      "/tmp/test-app/public/media",
      { recursive: true }
    );

    // The manifest should store an /airo-assets/uploads/ URL, not /assets/photo.jpg
    const manifestWriteCall = vi.mocked(fs.writeFile).mock.calls.find(
      (call) => String(call[0]).includes("airo-media.json")
    );
    expect(manifestWriteCall).toBeDefined();
    const writtenManifest = JSON.parse(manifestWriteCall![1] as string);
    const slot = writtenManifest["pages/home/test-photo"];

    expect(slot).toBeDefined();
    expect(slot.currentUrl).toMatch(/^\/airo-assets\/uploads\/pages-home-test-photo-[a-f0-9]+\.jpg$/);
    expect(slot.alternatives[0]).toBe(slot.currentUrl);
  });

  it("keeps original URL when local file copy fails", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    // fs.access rejects (default) → file not found → keeps original URL

    await service.importSlot("test-app", {
      imageUrl: "https://localhost:5009/assets/missing.jpg",
      imageAlt: "Missing",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 10,
      },
    });

    const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
    const writtenManifest = JSON.parse(writeCall[1] as string);
    const slot = writtenManifest["pages/home/missing"];

    expect(slot).toBeDefined();
    expect(slot.currentUrl).toBe("/assets/missing.jpg");
  });

  it("creates slot with correct MediaSlot shape", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    await service.importSlot("test-app", {
      imageUrl: "https://example.com/photo.jpg",
      imageAlt: "Hero image",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 10,
      },
    });

    const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
    const writtenManifest = JSON.parse(writeCall[1] as string);
    const slot = writtenManifest["pages/home/hero-image"];

    expect(slot).toMatchObject({
      mediaType: "image",
      currentUrl: "https://example.com/photo.jpg",
      searchQuery: "",
      userModified: false,
    });
    expect(slot.alternatives).toHaveLength(1);
    expect(slot.createdAt).toBeDefined();
    expect(slot.lastUpdated).toBeDefined();
  });

  it("appends counter when slot path already exists", async () => {
    const existingManifest = {
      "pages/about/hero-banner": {
        mediaType: "image",
        currentUrl: "https://old.com/img.jpg",
        searchQuery: "",
        alternatives: [],
        userModified: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUpdated: "2026-01-01T00:00:00.000Z",
      },
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingManifest));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/assets/hero-banner.jpg",
      devContext: {
        fileName: "src/pages/about.tsx",
        componentName: "unknown",
        lineNumber: 50,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("pages/about/hero-banner-2");
  });

  it("uses fallback path when dev context is missing", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/photo.jpg",
      devContext: undefined,
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toMatch(/^imported\/image-\d+$/);
  });

  it("maps index.tsx to pages/home", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/photo.jpg",
      imageAlt: "Dog photo",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 82,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("pages/home/dog-photo");
  });

  describe("AST source update", () => {
    it("calls astImageEditor.replaceImage with slot URL as newImageUrl", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await service.importSlot("test-app", {
        imageUrl: "https://example.com/photo.jpg",
        imageAlt: "Hero",
        devContext: {
          fileName: "src/pages/index.tsx",
          componentName: "HeroSection",
          lineNumber: 10,
        },
      });

      expect(astImageEditor.replaceImage).toHaveBeenCalledWith(
        "/tmp/test-app",
        expect.objectContaining({
          newImageUrl: "/airo-assets/images/pages/home/hero",
        }),
        "test-app"
      );
    });

    it("passes original URL as currentUrl so AST editor can match source code", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      // External URL — no local copy, normalizedUrl stays the same
      await service.importSlot("test-app", {
        imageUrl: "https://example.com/photo.jpg",
        imageAlt: "Hero",
        devContext: {
          fileName: "src/pages/index.tsx",
          componentName: "HeroSection",
          lineNumber: 10,
        },
      });

      // The source code has "https://example.com/photo.jpg" — AST editor
      // needs this exact URL to find and replace the element
      expect(astImageEditor.replaceImage).toHaveBeenCalledWith(
        "/tmp/test-app",
        expect.objectContaining({
          imageInfo: expect.objectContaining({
            currentUrl: "https://example.com/photo.jpg",
          }),
        }),
        "test-app"
      );
    });

    it("passes pre-copy URL as currentUrl when local file is copied to media dir", async () => {
      const fakeImageBuffer = Buffer.from("fake-image-data");
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({}))      // manifest
        .mockResolvedValueOnce(fakeImageBuffer as any);  // image file
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockResolvedValue(undefined); // file exists
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      await service.importSlot("test-app", {
        imageUrl: "https://localhost:5009/assets/photo.jpg",
        imageAlt: "Test photo",
        devContext: {
          fileName: "src/pages/index.tsx",
          componentName: "HeroSection",
          lineNumber: 10,
        },
      });

      // The source code has "/assets/photo.jpg" (or the full localhost URL).
      // AST editor must receive a currentUrl that matches the source — NOT
      // the post-copy /airo-assets/uploads/ URL which doesn't exist in source.
      const replaceCall = vi.mocked(astImageEditor.replaceImage).mock.calls[0];
      expect(replaceCall).toBeDefined();

      const imageInfo = replaceCall[1].imageInfo;
      // Must NOT be the copied upload URL
      expect(imageInfo.currentUrl).not.toMatch(/^\/airo-assets\/uploads\//);
      // Should be the normalized pathname that matches what's in source code
      expect(imageInfo.currentUrl).toBe("/assets/photo.jpg");
    });

    it("skips AST update when devContext is not provided", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await service.importSlot("test-app", {
        imageUrl: "https://example.com/photo.jpg",
        devContext: undefined,
      });

      expect(astImageEditor.replaceImage).not.toHaveBeenCalled();
    });
  });
});

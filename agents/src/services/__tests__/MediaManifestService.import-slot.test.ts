import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import type { MediaSlot } from "../MediaManifestService.js";

vi.mock("node:fs/promises", () => {
  // FileUploadService (a module-singleton built when MediaManifestService is
  // imported) does `import { mkdir, … } from 'fs/promises'` and calls mkdir() in
  // its constructor, so the mock must expose NAMED exports too — not just
  // default — and mkdir must resolve at import time, before any beforeEach runs.
  const mod = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  };
  return { default: mod, ...mod };
});

vi.mock("../../database/repositories/AppRepository.js", () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi
      .fn()
      .mockReturnValue({ id: "test-app", path: "/tmp/test-app" }),
  }; }),
}));

vi.mock("../../utils/dev-supervisor-client-factory.js", () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn().mockReturnValue(null) },
}));

vi.mock("../../utils/git.js", () => ({
  GitUtils: vi.fn(),
}));

vi.mock("../../logging/index.js", () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: stub,
    Logger: { create: vi.fn(() => stub) },
  };
});

vi.mock("../../workspace/index.js", () => ({
  createForWorkspace: () => ({ tasks: {} }),
}));

vi.mock("../../tools/ast-image-editor.js", () => ({
  astImageEditor: {
    replaceImage: vi.fn().mockResolvedValue({ success: true }),
    replaceUrlInSource: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("../GettyUploadService.js", () => ({
  gettyUploadService: {
    uploadAndReport: vi.fn().mockResolvedValue([]),
    reportUsage: vi.fn(),
  },
}));

import { AppRepository } from "../../database/repositories/AppRepository.js";
import { astImageEditor } from "../../tools/ast-image-editor.js";
import { MediaManifestService } from "../MediaManifestService.js";

const fileStat = { isFile: () => true } as Awaited<ReturnType<typeof fs.stat>>;
const dirStat = { isFile: () => false } as Awaited<ReturnType<typeof fs.stat>>;

describe("MediaManifestService - importSlot", () => {
  let service: MediaManifestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MediaManifestService();

    vi.mocked(fs.stat).mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
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
    vi.mocked(fs.stat).mockResolvedValue(fileStat);
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

    expect(fs.stat).toHaveBeenCalledWith(
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

  it("copies test preview host image using pathname like localhost", async () => {
    const fakeImageBuffer = Buffer.from("fake-image-data");
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(JSON.stringify({}))
      .mockResolvedValueOnce(fakeImageBuffer as any);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockResolvedValue(fileStat);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);

    await service.importSlot("test-app", {
      imageUrl:
        "https://437ewcbzah.preview.c4.test-airoapp.ai/assets/images/f2a2018247347906af77a0263c42eab7.jpg",
      imageAlt: "Hero",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 10,
      },
    });

    expect(fs.stat).toHaveBeenCalledWith(
      "/tmp/test-app/public/assets/images/f2a2018247347906af77a0263c42eab7.jpg"
    );
  });

  describe("host preview workspace layout", () => {
    beforeEach(() => {
      vi.mocked(AppRepository).mockImplementation(function () { return {
        findById: vi.fn().mockReturnValue({
          id: "test-app",
          path: "/tmp/airo-app-builder/hostapp/preview",
        }),
      }; });
    });

    afterEach(() => {
      vi.mocked(AppRepository).mockImplementation(function () { return {
        findById: vi.fn().mockReturnValue({ id: "test-app", path: "/tmp/test-app" }),
      }; });
    });

    it("reads local rebuild assets from assets/public when app path is .../preview", async () => {
      const previewLayoutService = new MediaManifestService();

      const fakeImageBuffer = Buffer.from("from-assets-public");
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({}))
        .mockResolvedValueOnce(fakeImageBuffer as any);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      vi.mocked(fs.stat).mockImplementation(function statForPreviewLayout(p: string | Buffer | URL) {
        const s = String(p);
        if (s.includes("/preview/public/")) {
          return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
        }
        if (s.includes("/assets/public/images/logo.png")) {
          return Promise.resolve(fileStat);
        }
        return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      });

      const result = await previewLayoutService.importSlot("test-app", {
        imageUrl: "https://localhost:5009/assets/images/logo.png",
        imageAlt: "Logo",
        devContext: {
          fileName: "src/pages/index.tsx",
          componentName: "unknown",
          lineNumber: 10,
        },
      });

      expect(result.success).toBe(true);
      expect(fs.stat).toHaveBeenCalledWith(
        "/tmp/airo-app-builder/hostapp/preview/public/assets/images/logo.png"
      );
      expect(fs.stat).toHaveBeenCalledWith(
        "/tmp/airo-app-builder/hostapp/assets/public/images/logo.png"
      );
    });
  });

  it("fails import when local file copy cannot read source under public/", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    const result = await service.importSlot("test-app", {
      imageUrl: "https://localhost:5009/assets/missing.jpg",
      imageAlt: "Missing",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 10,
      },
    });

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/Could not read the image under public\//);
    const manifestWrites = vi.mocked(fs.writeFile).mock.calls.filter((call) =>
      String(call[0]).includes("airo-media.json")
    );
    expect(manifestWrites).toHaveLength(0);
    expect(astImageEditor.replaceImage).not.toHaveBeenCalled();
  });

  it("fails import when candidate path exists but is a directory", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockResolvedValue(dirStat);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://localhost:5009/assets/some-dir",
      imageAlt: "Missing",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 10,
      },
    });

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/Could not read the image under public\//);
  });

  it("decodes percent-encoded spaces in filenames before filesystem lookup", async () => {
    const fakeImageBuffer = Buffer.from("fake-image-data");
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(JSON.stringify({}))
      .mockResolvedValueOnce(fakeImageBuffer as any);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);

    vi.mocked(fs.stat).mockImplementation((p: string | Buffer | URL) => {
      if (String(p) === "/tmp/test-app/public/assets/foo bar.jpeg") {
        return Promise.resolve(fileStat);
      }
      return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    });

    const result = await service.importSlot("test-app", {
      imageUrl: "https://localhost:5009/assets/foo%20bar.jpeg",
      imageAlt: "Spaced",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 10,
      },
    });

    expect(result.success).toBe(true);
    expect(fs.stat).toHaveBeenCalledWith("/tmp/test-app/public/assets/foo bar.jpeg");
    expect(vi.mocked(fs.stat).mock.calls.every(([p]) => !String(p).includes("%20"))).toBe(true);
  });

  // Bare-path input here — full http(s) URLs would have `..` collapsed by URL.pathname before reaching the guard.
  it("blocks percent-encoded path traversal after decoding", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "/assets/%2e%2e/secret.jpg",
      imageAlt: "Traversal",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 10,
      },
    });

    expect(result).toMatchObject({ success: false, httpStatus: 400 });
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it("fails cleanly on malformed percent-encoding", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "/assets/foo%E0%A4%A.jpeg",
      imageAlt: "Malformed",
      devContext: {
        fileName: "src/pages/index.tsx",
        componentName: "unknown",
        lineNumber: 10,
      },
    });

    expect(result).toMatchObject({ success: false, httpStatus: 400 });
    expect(fs.stat).not.toHaveBeenCalled();
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

  it("returns existing slot when same element re-imported (dedup by path + sourceRef)", async () => {
    const existingManifest = {
      "pages/about/hero-banner": {
        mediaType: "image",
        currentUrl: "https://old.com/img.jpg",
        searchQuery: "",
        alternatives: [],
        userModified: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUpdated: "2026-01-01T00:00:00.000Z",
        sourceRef: "src/pages/about.tsx:50",
      },
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingManifest));

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/assets/hero-banner.jpg",
      devContext: {
        fileName: "src/pages/about.tsx",
        componentName: "unknown",
        lineNumber: 50,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("pages/about/hero-banner");
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("creates separate slot when different element shares same derived path", async () => {
    const existingManifest = {
      "pages/about/hero-banner": {
        mediaType: "image",
        currentUrl: "https://old.com/img.jpg",
        searchQuery: "",
        alternatives: [],
        userModified: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUpdated: "2026-01-01T00:00:00.000Z",
        sourceRef: "src/pages/about.tsx:10",
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
        lineNumber: 200,
      },
    });

    expect(result.success).toBe(true);
    // Different element (line 200 vs 10) → gets counter suffix
    expect(result.slotPath).toBe("pages/about/hero-banner-2");
  });

  it("returns existing slot when same URL + same sourceRef (dedup by URL)", async () => {
    const existingManifest = {
      "pages/home/hero": {
        mediaType: "image",
        currentUrl: "https://example.com/photo.jpg",
        searchQuery: "",
        alternatives: ["https://example.com/photo.jpg"],
        userModified: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUpdated: "2026-01-01T00:00:00.000Z",
        sourceRef: "src/pages/about.tsx:99",
      },
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingManifest));

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/photo.jpg",
      imageAlt: "Different alt text",
      devContext: {
        fileName: "src/pages/about.tsx",
        componentName: "unknown",
        lineNumber: 99,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("pages/home/hero");
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("creates separate slot when same URL but different sourceRef", async () => {
    const existingManifest = {
      "pages/home/hero": {
        mediaType: "image",
        currentUrl: "https://example.com/photo.jpg",
        searchQuery: "",
        alternatives: ["https://example.com/photo.jpg"],
        userModified: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUpdated: "2026-01-01T00:00:00.000Z",
        sourceRef: "src/pages/index.tsx:10",
      },
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingManifest));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/photo.jpg",
      imageAlt: "Photo",
      devContext: {
        fileName: "src/pages/about.tsx",
        componentName: "unknown",
        lineNumber: 50,
      },
    });

    expect(result.success).toBe(true);
    // Different source element → gets its own slot
    expect(result.slotPath).toBe("pages/about/photo");
    expect(fs.writeFile).toHaveBeenCalled();
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

  it("maps layouts/parts/Header.tsx to layouts/header", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/logo.png",
      imageAlt: "Site logo",
      devContext: {
        fileName: "src/layouts/parts/Header.tsx",
        componentName: "Header",
        lineNumber: 8,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("layouts/header/site-logo");
  });

  it("maps layouts/parts/Footer.tsx to layouts/footer", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/logo.png",
      imageAlt: "Footer logo",
      devContext: {
        fileName: "src/layouts/parts/Footer.tsx",
        componentName: "Footer",
        lineNumber: 12,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("layouts/footer/footer-logo");
  });

  it("maps layouts/Website.tsx to layouts/website", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/bg.jpg",
      imageAlt: "Background",
      devContext: {
        fileName: "src/layouts/Website.tsx",
        componentName: "Website",
        lineNumber: 5,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("layouts/website/background");
  });

  it("maps components/HeroSection.tsx to components/herosection", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/hero.jpg",
      imageAlt: "Hero banner",
      devContext: {
        fileName: "src/components/HeroSection.tsx",
        componentName: "HeroSection",
        lineNumber: 15,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("components/herosection/hero-banner");
  });

  it("maps components/ui/Card.tsx to components/card", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/placeholder.jpg",
      imageAlt: "Card image",
      devContext: {
        fileName: "src/components/ui/Card.tsx",
        componentName: "Card",
        lineNumber: 20,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("components/card/card-image");
  });

  it("maps sections/AboutSection.tsx to sections/aboutsection", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/team.jpg",
      imageAlt: "Team photo",
      devContext: {
        fileName: "src/sections/AboutSection.tsx",
        componentName: "AboutSection",
        lineNumber: 25,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("sections/aboutsection/team-photo");
  });

  it("falls back to pages/unknown for unrecognized directories", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await service.importSlot("test-app", {
      imageUrl: "https://example.com/photo.jpg",
      imageAlt: "Photo",
      devContext: {
        fileName: "src/utils/helpers.tsx",
        componentName: "unknown",
        lineNumber: 5,
      },
    });

    expect(result.success).toBe(true);
    expect(result.slotPath).toBe("pages/unknown/photo");
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
      vi.mocked(fs.stat).mockResolvedValue(fileStat);
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

    it("falls back to URL-based source rewrite when JSX replace refuses a dynamic src", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      vi.mocked(astImageEditor.replaceImage).mockResolvedValueOnce({
        success: false,
        error:
          "Image src at line 6 uses a dynamic expression that cannot be safely rewritten. Edit the source array or prop declaration directly.",
      });

      const result = await service.importSlot("test-app", {
        imageUrl: "https://example.com/eng.jpg",
        imageAlt: "Engineering",
        devContext: {
          fileName: "src/pages/services.tsx",
          componentName: "Services",
          lineNumber: 6,
        },
      });

      expect(result.success).toBe(true);
      expect(astImageEditor.replaceUrlInSource).toHaveBeenCalledWith(
        "/tmp/test-app",
        expect.objectContaining({
          oldUrl: "https://example.com/eng.jpg",
          newUrl: "/airo-assets/images/pages/services/engineering",
          label: "Engineering",
          scopeFile: "src/pages/services.tsx",
        }),
        "test-app"
      );
    });

    it("commits the data file the URL fallback actually rewrote, not just the clicked component", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      vi.mocked(astImageEditor.replaceImage).mockResolvedValueOnce({
        success: false,
        error: "dynamic expression that cannot be safely rewritten",
      });
      vi.mocked(astImageEditor.replaceUrlInSource).mockResolvedValueOnce({
        success: true,
        filePath: "src/data/services.ts",
      });

      const commitSpy = vi
        .spyOn(service as unknown as { commitManifestChange: (...args: unknown[]) => Promise<unknown> }, "commitManifestChange")
        .mockResolvedValue(undefined);

      await service.importSlot("test-app", {
        imageUrl: "https://example.com/eng.jpg",
        imageAlt: "Engineering",
        devContext: {
          fileName: "src/pages/services.tsx",
          componentName: "Services",
          lineNumber: 6,
        },
      });

      const additionalFiles = commitSpy.mock.calls[0]?.[3] as string[] | undefined;
      expect(additionalFiles).toContain("src/data/services.ts");

      commitSpy.mockRestore();
    });

    it("still succeeds (manifest import) and stages only the clicked file when JSX refuses AND the URL fallback also fails", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      vi.mocked(astImageEditor.replaceImage).mockResolvedValueOnce({
        success: false,
        error: "dynamic expression that cannot be safely rewritten",
      });
      vi.mocked(astImageEditor.replaceUrlInSource).mockResolvedValueOnce({
        success: false,
        error: "URL not found in source",
      });

      const commitSpy = vi
        .spyOn(service as unknown as { commitManifestChange: (...args: unknown[]) => Promise<unknown> }, "commitManifestChange")
        .mockResolvedValue(undefined);

      const result = await service.importSlot("test-app", {
        imageUrl: "https://example.com/eng.jpg",
        imageAlt: "Engineering",
        devContext: {
          fileName: "src/pages/services.tsx",
          componentName: "Services",
          lineNumber: 6,
        },
      });

      // Manifest import is independent of the source rewrite — slot is still created.
      expect(result.success).toBe(true);

      // No phantom file staged: only the clicked component, since the fallback
      // never resolved a different file to rewrite.
      const additionalFiles = commitSpy.mock.calls[0]?.[3] as string[] | undefined;
      expect(additionalFiles).toEqual(["src/pages/services.tsx"]);

      commitSpy.mockRestore();
    });

    it("does not call the URL fallback when JSX replace succeeds", async () => {
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

      expect(astImageEditor.replaceImage).toHaveBeenCalled();
      expect(astImageEditor.replaceUrlInSource).not.toHaveBeenCalled();
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

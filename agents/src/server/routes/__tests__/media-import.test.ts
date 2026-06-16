import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../../services/MediaManifestService.js", () => ({
  mediaManifestService: {
    importSlot: vi.fn(),
  },
}));

vi.mock("../../middleware/app-ownership.js", () => ({
  validateAppOwnership: vi.fn(function (_req: any, _res: any, next: any) { return next(); }),
}));

vi.mock("../../../logging/index.js", () => {
  const makeMockLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => makeMockLogger() });
  return { logger: makeMockLogger(), Logger: { create: makeMockLogger } };
});

vi.mock("../../../services/FileUploadService.js", () => ({
  fileUploadService: { listUploadedFiles: vi.fn(), getAppUploadsDir: vi.fn(), getFilePath: vi.fn() },
}));

vi.mock("../../../services/ImageProcessingService.js", () => ({
  imageProcessingService: {},
}));

vi.mock("../../../database/repositories/AppRepository.js", () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {}; }),
}));

import { mediaManifestService } from "../../../services/MediaManifestService.js";

const { default: mediaRouter } = await import("../media.js");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.agentContext = { siteId: "test-site" };
    next();
  });
  app.use("/media", mediaRouter);
  return app;
}

describe("POST /media/:appId/slots/import", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("returns 200 with slotPath on success", async () => {
    vi.mocked(mediaManifestService.importSlot).mockResolvedValue({
      success: true,
      slotPath: "pages/about/hero-section",
    });

    const res = await request(app)
      .post("/media/test-app/slots/import")
      .send({
        imageUrl: "https://example.com/photo.jpg",
        devContext: {
          fileName: "src/frontend/pages/about.page.tsx",
          componentName: "HeroSection",
          lineNumber: 42,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      slotPath: "pages/about/hero-section",
    });
    expect(mediaManifestService.importSlot).toHaveBeenCalledWith("test-app", {
      imageUrl: "https://example.com/photo.jpg",
      devContext: {
        fileName: "src/frontend/pages/about.page.tsx",
        componentName: "HeroSection",
        lineNumber: 42,
      },
    });
  });

  it("returns 400 when imageUrl is missing", async () => {
    const res = await request(app)
      .post("/media/test-app/slots/import")
      .send({
        devContext: {
          fileName: "test.tsx",
          componentName: "Test",
          lineNumber: 1,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 500 when importSlot reports server error", async () => {
    vi.mocked(mediaManifestService.importSlot).mockResolvedValue({
      success: false,
      error: "Failed to read manifest",
      httpStatus: 500,
    });

    const res = await request(app)
      .post("/media/test-app/slots/import")
      .send({ imageUrl: "https://example.com/photo.jpg" });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when importSlot reports client error", async () => {
    vi.mocked(mediaManifestService.importSlot).mockResolvedValue({
      success: false,
      error: "Could not read the image under public/",
      httpStatus: 400,
    });

    const res = await request(app)
      .post("/media/test-app/slots/import")
      .send({ imageUrl: "https://example.com/photo.jpg" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 404 when importSlot reports app not found", async () => {
    vi.mocked(mediaManifestService.importSlot).mockResolvedValue({
      success: false,
      error: "App not found",
      httpStatus: 404,
    });

    const res = await request(app)
      .post("/media/test-app/slots/import")
      .send({ imageUrl: "https://example.com/photo.jpg" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("works without devContext (uses fallback path)", async () => {
    vi.mocked(mediaManifestService.importSlot).mockResolvedValue({
      success: true,
      slotPath: "imported/image-1234567890",
    });

    const res = await request(app)
      .post("/media/test-app/slots/import")
      .send({ imageUrl: "https://example.com/photo.jpg" });

    expect(res.status).toBe(200);
    expect(res.body.slotPath).toMatch(/^imported\/image-/);
  });
});

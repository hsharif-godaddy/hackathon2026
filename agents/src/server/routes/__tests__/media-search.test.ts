import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../middleware/app-ownership.js", () => ({
  validateAppOwnership: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../../../logging/index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("../../../services/FileUploadService.js", () => ({
  fileUploadService: { listUploadedFiles: vi.fn(), getAppUploadsDir: vi.fn(), getFilePath: vi.fn() },
}));

vi.mock("../../../services/ImageProcessingService.js", () => ({
  imageProcessingService: {},
}));

vi.mock("../../../services/MediaManifestService.js", () => ({
  mediaManifestService: {
    getSlot: vi.fn(),
    updateSlot: vi.fn(),
    importSlot: vi.fn(),
    getManifest: vi.fn(),
    updateSlotWithUpload: vi.fn(),
  },
}));

vi.mock("../../../database/repositories/AppRepository.js", () => ({
  AppRepository: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../services/image-search/normalize.js", () => ({
  normalizeSearchQuery: vi.fn((q: string) => Promise.resolve(q)),
}));

const { default: mediaRouter } = await import("../media.js");

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/media", mediaRouter);
  return app;
}

function makeGettyResponse(images: Array<{ id: string; uri: string; sizeName?: string }>) {
  return {
    ok: true,
    text: async () => '',
    json: async () => ({
      result_count: images.length,
      images: images.map(({ id, uri, sizeName = 'comp' }) => ({
        id,
        display_sizes: [{ name: sizeName, uri, is_watermarked: true }],
      })),
    }),
  };
}

describe("GET /media/:appId/search", () => {
  let app: express.Express;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 400 when q param is missing", async () => {
    const res = await request(app).get("/media/test-app/search");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/q is required/i);
  });

  it("returns 400 when q is an empty string", async () => {
    const res = await request(app).get("/media/test-app/search?q=   ");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns images and gettyIds on success", async () => {
    mockFetch.mockResolvedValueOnce(makeGettyResponse([
      { id: "g1", uri: "https://cdn.getty.com/img1.jpg" },
      { id: "g2", uri: "https://cdn.getty.com/img2.jpg" },
    ]));

    const res = await request(app).get("/media/test-app/search?q=dogs");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.images).toEqual([
      "https://cdn.getty.com/img1.jpg",
      "https://cdn.getty.com/img2.jpg",
    ]);
    expect(res.body.gettyIds).toEqual(["g1", "g2"]);
    expect(res.body.totalResults).toBe(2);
  });

  it("prefers high_res_comp over lower-quality display sizes", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '',
      json: async () => ({
        result_count: 1,
        images: [{
          id: "g1",
          display_sizes: [
            { name: "preview", uri: "https://cdn.getty.com/preview.jpg", is_watermarked: true },
            { name: "high_res_comp", uri: "https://cdn.getty.com/highres.jpg", is_watermarked: false },
            { name: "comp", uri: "https://cdn.getty.com/comp.jpg", is_watermarked: true },
          ],
        }],
      }),
    });

    const res = await request(app).get("/media/test-app/search?q=dogs");

    expect(res.status).toBe(200);
    expect(res.body.images).toEqual(["https://cdn.getty.com/highres.jpg"]);
  });

  it("skips items with no usable display size", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '',
      json: async () => ({
        result_count: 2,
        images: [
          { id: "g1", display_sizes: [] },
          { id: "g2", display_sizes: [{ name: "comp", uri: "https://cdn.getty.com/img2.jpg", is_watermarked: true }] },
        ],
      }),
    });

    const res = await request(app).get("/media/test-app/search?q=dogs");

    expect(res.status).toBe(200);
    expect(res.body.images).toEqual(["https://cdn.getty.com/img2.jpg"]);
    expect(res.body.gettyIds).toEqual(["g2"]);
  });

  it("passes orientation to Getty API when provided", async () => {
    mockFetch.mockResolvedValueOnce(makeGettyResponse([]));

    await request(app).get("/media/test-app/search?q=dogs&orientations=horizontal");

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("orientations=horizontal");
  });

  it("omits orientation param when value is 'any'", async () => {
    mockFetch.mockResolvedValueOnce(makeGettyResponse([]));

    await request(app).get("/media/test-app/search?q=dogs&orientations=any");

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).not.toContain("orientations");
  });

  it("returns 502 when Getty API responds with a non-OK status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const res = await request(app).get("/media/test-app/search?q=dogs");

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Getty search failed/i);
  });

  it("returns 500 when fetch throws a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app).get("/media/test-app/search?q=dogs");

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it("defaults page to 1 and pageSize to 9", async () => {
    mockFetch.mockResolvedValueOnce(makeGettyResponse([]));

    await request(app).get("/media/test-app/search?q=dogs");

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("page_size=9");
  });

  it("clamps pageSize to 24", async () => {
    mockFetch.mockResolvedValueOnce(makeGettyResponse([]));

    await request(app).get("/media/test-app/search?q=dogs&pageSize=100");

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("page_size=24");
  });

  it("normalizes long queries before sending to Getty", async () => {
    const { normalizeSearchQuery } = await import("../../../services/image-search/normalize.js");
    const mockNormalize = vi.mocked(normalizeSearchQuery);
    mockNormalize.mockResolvedValueOnce("sunset mountains");
    mockFetch.mockResolvedValueOnce(makeGettyResponse([]));

    await request(app).get("/media/test-app/search?q=a+beautiful+hero+image+of+a+sunset+over+mountains");

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("phrase=sunset+mountains");
    expect(mockNormalize).toHaveBeenCalledWith("a beautiful hero image of a sunset over mountains");
  });

  it("omits Authorization header when no token is configured", async () => {
    delete process.env.GETTY_TOKEN;
    delete process.env.SSO_JWT;
    mockFetch.mockResolvedValueOnce(makeGettyResponse([]));

    await request(app).get("/media/test-app/search?q=dogs");

    const [, fetchInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = fetchInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../middleware/app-ownership.js", () => ({
  validateAppOwnership: vi.fn(function (_req: unknown, _res: unknown, next: () => void) { return next(); }),
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
  AppRepository: vi.fn().mockImplementation(function () { return {}; }),
}));

vi.mock("../../../services/image-search/normalize.js", () => ({
  normalizeSearchQuery: vi.fn(function (q: string) { return Promise.resolve(q); }),
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
    process.env.SSO_JWT = 'test-jwt';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SSO_JWT;
    delete process.env.GOCODE_USE_S2S_AUTH;
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
    delete process.env.SSO_JWT;
    delete process.env.GOCODE_USE_S2S_AUTH;
    delete process.env.GETTY_TOKEN;
    mockFetch.mockResolvedValueOnce(makeGettyResponse([]));

    await request(app).get("/media/test-app/search?q=dogs");

    const [, fetchInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = fetchInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });
});

function makeGettyVideoResponse(videos: Array<{ id: string; previewUri: string; thumbUri?: string }>) {
  return {
    ok: true,
    text: async () => '',
    json: async () => ({
      result_count: videos.length,
      videos: videos.map(({ id, previewUri, thumbUri }) => ({
        id,
        display_sizes: [
          { name: 'comp', uri: previewUri },
          ...(thumbUri ? [{ name: 'comp_poster', uri: thumbUri }] : []),
        ],
      })),
    }),
  };
}

describe("GET /media/:appId/video-search", () => {
  let app: express.Express;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    process.env.SSO_JWT = 'test-jwt';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SSO_JWT;
    delete process.env.GOCODE_USE_S2S_AUTH;
  });

  it("returns 400 when q param is missing", async () => {
    const res = await request(app).get("/media/test-app/video-search");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/q is required/i);
  });

  it("returns 400 when q is an empty string", async () => {
    const res = await request(app).get("/media/test-app/video-search?q=   ");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns videos, thumbnails and gettyIds on success", async () => {
    mockFetch.mockResolvedValueOnce(makeGettyVideoResponse([
      { id: "v1", previewUri: "https://cdn.getty.com/vid1.mp4", thumbUri: "https://cdn.getty.com/thumb1.jpg" },
      { id: "v2", previewUri: "https://cdn.getty.com/vid2.mp4" },
    ]));

    const res = await request(app).get("/media/test-app/video-search?q=ocean");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.videos).toEqual([
      "https://cdn.getty.com/vid1.mp4",
      "https://cdn.getty.com/vid2.mp4",
    ]);
    expect(res.body.thumbnails).toEqual([
      "https://cdn.getty.com/thumb1.jpg",
      "https://cdn.getty.com/vid2.mp4",
    ]);
    expect(res.body.gettyIds).toEqual(["v1", "v2"]);
  });

  it("deduplicates items by id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '',
      json: async () => ({
        result_count: 2,
        videos: [
          { id: "v1", display_sizes: [{ name: "comp", uri: "https://cdn.getty.com/vid1.mp4" }] },
          { id: "v1", display_sizes: [{ name: "comp", uri: "https://cdn.getty.com/vid1-dup.mp4" }] },
        ],
      }),
    });

    const res = await request(app).get("/media/test-app/video-search?q=ocean");

    expect(res.body.videos).toHaveLength(1);
    expect(res.body.gettyIds).toEqual(["v1"]);
  });

  it("passes orientations to Getty API when provided", async () => {
    mockFetch.mockResolvedValueOnce(makeGettyVideoResponse([]));

    await request(app).get("/media/test-app/video-search?q=ocean&orientations=horizontal");

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("orientations=horizontal");
  });

  it("omits orientations param when value is 'any'", async () => {
    mockFetch.mockResolvedValueOnce(makeGettyVideoResponse([]));

    await request(app).get("/media/test-app/video-search?q=ocean&orientations=any");

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).not.toContain("orientations");
  });

  it("returns 502 when Getty API responds with non-OK status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const res = await request(app).get("/media/test-app/video-search?q=ocean");

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Getty video search failed/i);
  });

  it("returns 500 when fetch throws a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app).get("/media/test-app/video-search?q=ocean");

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it("clamps pageSize to 24", async () => {
    mockFetch.mockResolvedValueOnce(makeGettyVideoResponse([]));

    await request(app).get("/media/test-app/video-search?q=ocean&pageSize=100");

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("page_size=24");
  });

  it("uses sso-jwt auth header (not deprecated Bearer GETTY_TOKEN)", async () => {
    process.env.SSO_JWT = 'my-sso-jwt';
    mockFetch.mockResolvedValueOnce(makeGettyVideoResponse([]));

    await request(app).get("/media/test-app/video-search?q=ocean");

    const [, fetchInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = fetchInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe('sso-jwt my-sso-jwt');
  });

  it("normalizes long queries before sending to Getty", async () => {
    const { normalizeSearchQuery } = await import("../../../services/image-search/normalize.js");
    const mockNormalize = vi.mocked(normalizeSearchQuery);
    mockNormalize.mockResolvedValueOnce("ocean waves");
    mockFetch.mockResolvedValueOnce(makeGettyVideoResponse([]));

    await request(app).get("/media/test-app/video-search?q=a+beautiful+video+of+ocean+waves");

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("phrase=ocean+waves");
  });
});

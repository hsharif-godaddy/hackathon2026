import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KnowBDriver } from "../ai-lib-tools/drivers/knowb-driver.js";

describe("KnowBDriver", () => {
  let driver: KnowBDriver;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.GETTY_API_URL = "https://test-proxy.example.com";
    process.env.GETTY_TOKEN = "test-token";
    driver = new KnowBDriver();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GETTY_API_URL;
    delete process.env.GETTY_TOKEN;
  });

  describe("upload", () => {
    it("should upload content without header when not provided", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi
          .fn()
          .mockResolvedValue({ success: true, resourceId: "getty-123" }),
        text: vi.fn().mockResolvedValue('{"success":true}'),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await driver.upload({
        kbNodeId: "/airo_media",
        resourceId: "getty-123",
        content: "raw content without header",
        metadata: { type: "cache" },
      });

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe("getty-123");

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const formData = fetchCall[1].body as FormData;
      const file = formData.get("file") as Blob;
      const fileContent = await file.text();
      expect(fileContent).toBe("raw content without header");
    });

    it("should prepend header when provided", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi
          .fn()
          .mockResolvedValue({ success: true, resourceId: "getty-123" }),
        text: vi.fn().mockResolvedValue('{"success":true}'),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await driver.upload({
        kbNodeId: "/airo_media",
        resourceId: "getty-123",
        content: JSON.stringify({ description: "test image" }),
        metadata: { type: "image_analysis" },
        header: "Image Analysis",
      });

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe("getty-123");

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const formData = fetchCall[1].body as FormData;
      const file = formData.get("file") as Blob;
      const fileContent = await file.text();
      expect(fileContent).toContain("# Image Analysis: getty-123");
    });

    it("should handle upload errors gracefully", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("Internal Server Error"),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await driver.upload({
        kbNodeId: "/airo_media",
        resourceId: "getty-123",
        content: JSON.stringify({ description: "test" }),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

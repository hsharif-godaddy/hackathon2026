import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the knowb-driver before importing the service
vi.mock("../../tools/ai-lib-tools/drivers/knowb-driver.js", () => ({
  knowBDriver: {
    search: vi.fn(),
    upload: vi.fn(),
  },
}));

import {
  ImageAnalysisService,
  CachedAnalysis,
  GettyImage,
} from "../ImageAnalysisService.js";
import { knowBDriver } from "../../tools/ai-lib-tools/drivers/knowb-driver.js";

describe("ImageAnalysisService", () => {
  let service: ImageAnalysisService;

  beforeEach(() => {
    service = new ImageAnalysisService();
    vi.clearAllMocks();
  });

  describe("getCachedAnalysis", () => {
    it("should return cached analysis for found IDs", async () => {
      const mockSearchResult = {
        success: true,
        results: [
          {
            kbNodeId: "/airo_media/getty-123",
            text: JSON.stringify({
              gettyId: "getty-123",
              analysis: {
                description: "A sunset",
                composition: "centered",
                usageContext: "hero",
              },
              analyzedAt: "2026-01-26T12:00:00Z",
            }),
            score: 0.95,
          },
        ],
      };
      vi.mocked(knowBDriver.search).mockResolvedValue(mockSearchResult);

      const result = await service.getCachedAnalysis([
        "getty-123",
        "getty-456",
      ]);

      expect(result.has("getty-123")).toBe(true);
      expect(result.has("getty-456")).toBe(false);
      expect(result.get("getty-123")?.analysis.description).toBe("A sunset");
    });

    it("should return empty map when search fails", async () => {
      vi.mocked(knowBDriver.search).mockResolvedValue({
        success: false,
        error: "Network error",
      });

      const result = await service.getCachedAnalysis(["getty-123"]);

      expect(result.size).toBe(0);
    });

    it("should return empty map for empty input", async () => {
      const result = await service.getCachedAnalysis([]);

      expect(result.size).toBe(0);
      expect(knowBDriver.search).not.toHaveBeenCalled();
    });

    it("should handle parse errors gracefully", async () => {
      const mockSearchResult = {
        success: true,
        results: [
          {
            kbNodeId: "/airo_media/getty-123",
            text: "not valid json",
            score: 0.95,
          },
        ],
      };
      vi.mocked(knowBDriver.search).mockResolvedValue(mockSearchResult);

      const result = await service.getCachedAnalysis(["getty-123"]);

      expect(result.size).toBe(0);
    });

    it("should skip results where gettyId does not match", async () => {
      const mockSearchResult = {
        success: true,
        results: [
          {
            kbNodeId: "/airo_media/getty-999",
            text: JSON.stringify({
              gettyId: "getty-999", // Different from what we searched for
              analysis: {
                description: "Wrong image",
                composition: "centered",
                usageContext: "hero",
              },
              analyzedAt: "2026-01-26T12:00:00Z",
            }),
            score: 0.95,
          },
        ],
      };
      vi.mocked(knowBDriver.search).mockResolvedValue(mockSearchResult);

      const result = await service.getCachedAnalysis(["getty-123"]);

      expect(result.has("getty-123")).toBe(false);
    });
  });

  describe("analyzeImage", () => {
    it("should return null when image has no usable URL", async () => {
      const image = {
        id: "getty-789",
        urls: {},
      };

      const result = await service.analyzeImage(image);

      expect(result).toBeNull();
    });

    it("should return null when image has empty urls object", async () => {
      const image = {
        id: "getty-no-url",
        urls: {},
      };

      const result = await service.analyzeImage(image);

      expect(result).toBeNull();
    });
  });

  describe("cacheAnalysis", () => {
    it("should store analysis in goknowb", async () => {
      vi.mocked(knowBDriver.upload).mockResolvedValue({
        success: true,
        resourceId: "getty-123",
      });

      const analysis: CachedAnalysis = {
        gettyId: "getty-123",
        analysis: {
          description: "Test",
          composition: "centered",
          usageContext: "hero",
        },
        getty: { title: "Test Image" },
        urls: { preview: "https://example.com/preview.jpg" },
        analyzedAt: "2026-01-26T12:00:00Z",
      };

      await service.cacheAnalysis([analysis]);

      expect(knowBDriver.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          kbNodeId: "/airo_media_v2",
          resourceId: "getty-123",
        })
      );
    });

    it("should handle upload failures gracefully", async () => {
      vi.mocked(knowBDriver.upload).mockResolvedValue({
        success: false,
        error: "Upload failed",
      });

      const analysis: CachedAnalysis = {
        gettyId: "getty-456",
        analysis: {
          description: "Test",
          composition: "centered",
          usageContext: "hero",
        },
        getty: {},
        urls: {},
        analyzedAt: "2026-01-26T12:00:00Z",
      };

      // Should not throw
      await expect(service.cacheAnalysis([analysis])).resolves.not.toThrow();
    });
  });

  describe("scoreRelevance", () => {
    it("should score images by relevance to prompt", async () => {
      vi.mocked(knowBDriver.search).mockResolvedValue({
        success: true,
        results: [
          { kbNodeId: "/airo_media/getty-123", text: "gettyId:getty-123 ...", score: 0.85 },
          { kbNodeId: "/airo_media/getty-456", text: "gettyId:getty-456 ...", score: 0.45 },
        ],
      });

      const analyses: CachedAnalysis[] = [
        {
          gettyId: "getty-123",
          analysis: {
            description: "Sunset over mountains",
            composition: "centered",
            usageContext: "hero",
          },
          getty: {},
          urls: { preview: "https://example.com/1.jpg" },
          analyzedAt: "2026-01-26T12:00:00Z",
        },
        {
          gettyId: "getty-456",
          analysis: {
            description: "Office meeting room",
            composition: "centered",
            usageContext: "content",
          },
          getty: {},
          urls: { preview: "https://example.com/2.jpg" },
          analyzedAt: "2026-01-26T12:00:00Z",
        },
      ];

      const scored = await service.scoreRelevance("sunset mountains", analyses);

      expect(scored).toHaveLength(2);
      expect(scored[0].gettyId).toBe("getty-123");
      expect(scored[0].relevanceScore).toBe(0.85);
      expect(scored[1].relevanceScore).toBe(0.45);
    });

    it("should return images without scores when search fails", async () => {
      vi.mocked(knowBDriver.search).mockResolvedValue({
        success: false,
        error: "Search failed",
      });

      const analyses: CachedAnalysis[] = [
        {
          gettyId: "getty-789",
          analysis: {
            description: "Test",
            composition: "centered",
            usageContext: "hero",
          },
          getty: {},
          urls: { preview: "https://example.com/1.jpg" },
          analyzedAt: "2026-01-26T12:00:00Z",
        },
      ];

      const scored = await service.scoreRelevance("test prompt", analyses);

      expect(scored).toHaveLength(1);
      expect(scored[0].relevanceScore).toBeNull();
    });
  });

  describe("processSearchResults", () => {
    it("should process images with caching, analysis, and filtering", async () => {
      // Setup mocks for full flow
      vi.mocked(knowBDriver.search)
        .mockResolvedValueOnce({ success: false }) // Cache miss for getty-1
        .mockResolvedValueOnce({ success: false }) // Cache miss for getty-2
        .mockResolvedValueOnce({
          // Relevance scoring
          success: true,
          results: [
            { kbNodeId: "/airo_media", text: "gettyId:getty-1 ...", score: 0.75 },
            { kbNodeId: "/airo_media", text: "gettyId:getty-2 ...", score: 0.35 },
          ],
        });

      vi.mocked(knowBDriver.upload).mockResolvedValue({ success: true });

      // Mock the analyzeImageInternal method to return different analyses for each image
      const mockAnalysis1: CachedAnalysis = {
        gettyId: "getty-1",
        analysis: {
          description: "Sunset",
          composition: "centered",
          usageContext: "hero",
        },
        getty: {},
        urls: { preview: "https://example.com/1.jpg" },
        analyzedAt: "2026-01-26T12:00:00Z",
      };
      const mockAnalysis2: CachedAnalysis = {
        gettyId: "getty-2",
        analysis: {
          description: "Beach",
          composition: "left",
          usageContext: "content",
        },
        getty: {},
        urls: { preview: "https://example.com/2.jpg" },
        analyzedAt: "2026-01-26T12:00:00Z",
      };
      vi.spyOn(service as any, "analyzeImageInternal")
        .mockResolvedValueOnce({ analysis: mockAnalysis1 })
        .mockResolvedValueOnce({ analysis: mockAnalysis2 });

      const images: GettyImage[] = [
        { id: "getty-1", urls: { preview: "https://example.com/1.jpg" } },
        { id: "getty-2", urls: { preview: "https://example.com/2.jpg" } },
      ];

      const result = await service.processSearchResults("sunset beach", images, {
        threshold: 0.5,
        maxResults: 5,
      });

      expect(result.images).toHaveLength(1); // One filtered out below threshold
      expect(result.filtered).toBe(1);
      expect(result.images[0].gettyId).toBe("getty-1");
    });

    it("should return empty images array when no images pass threshold", async () => {
      vi.mocked(knowBDriver.search)
        .mockResolvedValueOnce({ success: false }) // Cache miss for getty-1
        .mockResolvedValueOnce({
          // Relevance scoring
          success: true,
          results: [
            { kbNodeId: "/airo_media_v2", text: "gettyId:getty-1 ...", score: 0.2 },
          ],
        });

      vi.spyOn(service as any, "analyzeImageInternal").mockResolvedValue({
        analysis: {
          gettyId: "getty-1",
          analysis: { description: "Test", composition: "centered", usageContext: "hero" },
          getty: {},
          urls: { preview: "https://example.com/1.jpg" },
          analyzedAt: "2026-01-26T12:00:00Z",
        },
      });

      const images: GettyImage[] = [
        { id: "getty-1", urls: { preview: "https://example.com/1.jpg" } },
      ];

      const result = await service.processSearchResults("unrelated query", images, {
        threshold: 0.5,
        maxResults: 5,
      });

      expect(result.images).toHaveLength(0);
      expect(result.filtered).toBe(1);
    });
  });
});

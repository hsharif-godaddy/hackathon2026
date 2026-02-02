import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("features", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("imageAnalysisEnabled", () => {
    it("should return false when IMAGE_ANALYSIS_ENABLED is unset", async () => {
      delete process.env.IMAGE_ANALYSIS_ENABLED;

      const { getFeatures } = await import("../features.js");
      const features = getFeatures();

      expect(features.enabledFeatures.imageAnalysisEnabled).toBe(false);
    });

    it("should return false when IMAGE_ANALYSIS_ENABLED is 'false'", async () => {
      process.env.IMAGE_ANALYSIS_ENABLED = "false";

      const { getFeatures } = await import("../features.js");
      const features = getFeatures();

      expect(features.enabledFeatures.imageAnalysisEnabled).toBe(false);
    });

    it("should return true when IMAGE_ANALYSIS_ENABLED is 'true'", async () => {
      process.env.IMAGE_ANALYSIS_ENABLED = "true";

      const { getFeatures } = await import("../features.js");
      const features = getFeatures();

      expect(features.enabledFeatures.imageAnalysisEnabled).toBe(true);
    });

    it("should return false when IMAGE_ANALYSIS_ENABLED is any other value", async () => {
      process.env.IMAGE_ANALYSIS_ENABLED = "yes";

      const { getFeatures } = await import("../features.js");
      const features = getFeatures();

      expect(features.enabledFeatures.imageAnalysisEnabled).toBe(false);
    });
  });

  describe("sessionFeedback", () => {
    it("should return false when ENABLE_SESSION_FEEDBACK is unset", async () => {
      delete process.env.ENABLE_SESSION_FEEDBACK;

      const { getFeatures } = await import("../features.js");
      const features = getFeatures();

      expect(features.enabledFeatures.sessionFeedback).toBe(false);
    });

    it("should return true when ENABLE_SESSION_FEEDBACK is 'true'", async () => {
      process.env.ENABLE_SESSION_FEEDBACK = "true";

      const { getFeatures } = await import("../features.js");
      const features = getFeatures();

      expect(features.enabledFeatures.sessionFeedback).toBe(true);
    });
  });
});

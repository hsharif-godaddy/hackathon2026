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

  describe("determineAuthType - fallback behavior", () => {
    it("falls back to JWT for NODE_ENV=production", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.AUTH_TYPE;
      const { getFeatures, AuthType } = await import("../features.js");
      expect(getFeatures().authType).toBe(AuthType.JWT);
    });

    it("falls back to MOCK for NODE_ENV=development", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.AUTH_TYPE;
      const { getFeatures, AuthType } = await import("../features.js");
      expect(getFeatures().authType).toBe(AuthType.MOCK);
    });

    it("falls back to MOCK for NODE_ENV=test", async () => {
      process.env.NODE_ENV = "test";
      delete process.env.AUTH_TYPE;
      const { getFeatures, AuthType } = await import("../features.js");
      expect(getFeatures().authType).toBe(AuthType.MOCK);
    });

    it("falls back to JWT for unknown NODE_ENV (security default)", async () => {
      process.env.NODE_ENV = "staging-weird";
      delete process.env.AUTH_TYPE;
      const { getFeatures, AuthType } = await import("../features.js");
      expect(getFeatures().authType).toBe(AuthType.JWT);
    });

    it("logs features.auth_type.unrecognized at error level for invalid AUTH_TYPE", async () => {
      process.env.NODE_ENV = "development";
      process.env.AUTH_TYPE = "none";

      const { Logger } = await import("../../logging/index.js");
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

      const { getFeatures, AuthType } = await import("../features.js");
      expect(getFeatures().authType).toBe(AuthType.MOCK);
      expect(errorSpy).toHaveBeenCalledWith(
        "features.auth_type.unrecognized",
        expect.objectContaining({ value: "none", nodeEnv: "development" }),
      );

      errorSpy.mockRestore();
    });

    it("AUTH_TYPE=none in production falls back to JWT and passes validation", async () => {
      process.env.NODE_ENV = "production";
      process.env.AUTH_TYPE = "none";
      process.env.SITE_ID = "prod-site-12345";

      const { Logger } = await import("../../logging/index.js");
      vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

      const { getFeatures, validateConfiguration, AuthType } = await import("../features.js");
      expect(getFeatures().authType).toBe(AuthType.JWT);
      expect(() => validateConfiguration()).not.toThrow();
    });
  });

  describe("validateConfiguration - Security Checks", () => {
    describe("Production Authentication Validation", () => {
      it("should pass when production uses JWT authentication", async () => {
        process.env.NODE_ENV = "production";
        process.env.AUTH_TYPE = "jwt";
        process.env.SITE_ID = "prod-site-12345";

        const { validateConfiguration } = await import("../features.js");
        expect(() => validateConfiguration()).not.toThrow();
      });

      it("should throw when production uses MOCK authentication", async () => {
        process.env.NODE_ENV = "production";
        process.env.AUTH_TYPE = "mock";
        process.env.SITE_ID = "prod-site-12345";

        const { validateConfiguration } = await import("../features.js");
        expect(() => validateConfiguration()).toThrow(
          /SECURITY: Production must use JWT authentication/
        );
      });

      it("should allow MOCK authentication in development", async () => {
        process.env.NODE_ENV = "development";
        process.env.AUTH_TYPE = "mock";
        process.env.SITE_ID = "mock-site-id";

        const { validateConfiguration } = await import("../features.js");
        expect(() => validateConfiguration()).not.toThrow();
      });

      it("should allow MOCK authentication in test environment", async () => {
        process.env.NODE_ENV = "test";
        process.env.AUTH_TYPE = "mock";
        process.env.SITE_ID = "mock-site-id";

        const { validateConfiguration } = await import("../features.js");
        expect(() => validateConfiguration()).not.toThrow();
      });
    });

    describe("BYPASS_SITE_IDS Validation", () => {
      it("should throw when production uses bypass-site", async () => {
        process.env.NODE_ENV = "production";
        process.env.SITE_ID = "bypass-site";

        const { validateConfiguration } = await import("../features.js");
        expect(() => validateConfiguration()).toThrow(
          /SECURITY: Production SITE_ID cannot be a bypass value/
        );
        expect(() => validateConfiguration()).toThrow(/bypass-site/);
      });

      it("should throw when production uses default-site", async () => {
        process.env.NODE_ENV = "production";
        process.env.SITE_ID = "default-site";

        const { validateConfiguration } = await import("../features.js");
        expect(() => validateConfiguration()).toThrow(
          /SECURITY: Production SITE_ID cannot be a bypass value/
        );
      });

      it("should throw when production uses local-dev-site", async () => {
        process.env.NODE_ENV = "production";
        process.env.SITE_ID = "local-dev-site";

        const { validateConfiguration } = await import("../features.js");
        expect(() => validateConfiguration()).toThrow(
          /SECURITY: Production SITE_ID cannot be a bypass value/
        );
      });

      it("should throw when production uses mock-site-id", async () => {
        process.env.NODE_ENV = "production";
        process.env.SITE_ID = "mock-site-id";

        const { validateConfiguration } = await import("../features.js");
        expect(() => validateConfiguration()).toThrow(
          /SECURITY: Production SITE_ID cannot be a bypass value/
        );
      });

      it("should throw when production uses unknown-site", async () => {
        process.env.NODE_ENV = "production";
        process.env.SITE_ID = "unknown-site";

        const { validateConfiguration } = await import("../features.js");
        expect(() => validateConfiguration()).toThrow(
          /SECURITY: Production SITE_ID cannot be a bypass value/
        );
      });

      it("should include all bypass values in error message", async () => {
        process.env.NODE_ENV = "production";
        process.env.SITE_ID = "bypass-site";

        const { validateConfiguration } = await import("../features.js");
        expect(() => validateConfiguration()).toThrow(
          /Bypass values are for development\/testing only: bypass-site, default-site, local-dev-site, mock-site-id, unknown-site/
        );
      });

      it("should allow bypass sites in development", async () => {
        process.env.NODE_ENV = "development";

        const { validateConfiguration, BYPASS_SITE_IDS } = await import("../features.js");
        for (const bypassSite of BYPASS_SITE_IDS) {
          process.env.SITE_ID = bypassSite;
          expect(() => validateConfiguration()).not.toThrow();
        }
      });

      it("should allow bypass sites in test environment", async () => {
        process.env.NODE_ENV = "test";

        const { validateConfiguration, BYPASS_SITE_IDS } = await import("../features.js");
        for (const bypassSite of BYPASS_SITE_IDS) {
          process.env.SITE_ID = bypassSite;
          expect(() => validateConfiguration()).not.toThrow();
        }
      });

      it("should allow legitimate site IDs in production", async () => {
        process.env.NODE_ENV = "production";

        const legitimateSiteIds = [
          "abc1234567", // nanoID(10)
          "550e8400-e29b-41d4-a716-446655440000", // UUID
          "prod-site-xyz",
          "customer-site-123"
        ];

        const { validateConfiguration } = await import("../features.js");
        for (const siteId of legitimateSiteIds) {
          process.env.SITE_ID = siteId;
          expect(() => validateConfiguration()).not.toThrow();
        }
      });
    });

    describe("Combined Security Violations", () => {
      it("should report all security violations at once", async () => {
        process.env.NODE_ENV = "production";
        process.env.AUTH_TYPE = "mock";
        process.env.SITE_ID = "bypass-site";

        const { validateConfiguration } = await import("../features.js");
        try {
          validateConfiguration();
          // Should not reach here
          expect.fail("Expected validateConfiguration to throw");
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          // Both security violations should be reported
          expect(errorMessage).toContain("SECURITY: Production must use JWT authentication");
          expect(errorMessage).toContain("SECURITY: Production SITE_ID cannot be a bypass value");
        }
      });
    });

    describe("BYPASS_SITE_IDS Constant", () => {
      it("should contain expected bypass values", async () => {
        const { BYPASS_SITE_IDS } = await import("../features.js");
        expect(BYPASS_SITE_IDS).toEqual([
          "bypass-site",
          "default-site",
          "local-dev-site",
          "mock-site-id",
          "unknown-site"
        ]);
      });

      it("should not be empty", async () => {
        const { BYPASS_SITE_IDS } = await import("../features.js");
        expect(BYPASS_SITE_IDS.length).toBeGreaterThan(0);
      });

      it("should have unique values", async () => {
        const { BYPASS_SITE_IDS } = await import("../features.js");
        const uniqueValues = new Set(BYPASS_SITE_IDS);
        expect(uniqueValues.size).toBe(BYPASS_SITE_IDS.length);
      });
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ProfileData } from "../../profiles/types.js";

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
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(function () {});

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
      vi.spyOn(Logger.prototype, "error").mockImplementation(function () {});

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

  describe("skills - profile-aware gating", () => {
    const testProfile: ProfileData = {
      name: "test-profile",
      description: "Test profile for skill gating",
      properties: {
        "skill.gated-skill.enabled": true,
        "skill.disabled-skill.enabled": false,
      },
    };

    it("returns static config value for skills in enabledSkills", async () => {
      process.env.ENABLE_SOCIAL = "true";

      const { skills } = await import("../features.js");
      expect(skills.isEnabled("social")).toBe(true);
    });

    it("returns false for static config when env var is not set", async () => {
      delete process.env.ENABLE_SOCIAL;

      const { skills } = await import("../features.js");
      expect(skills.isEnabled("social")).toBe(false);
    });

    it("returns true for profile-gated skill when profile enables it", async () => {
      const { skills, profileGatedSkills } = await import("../features.js");
      const { runWithProfile } = await import("../../profiles/profile-context.js");
      profileGatedSkills.add("gated-skill");

      const result = runWithProfile(testProfile, () => skills.isEnabled("gated-skill"));
      expect(result).toBe(true);

      profileGatedSkills.delete("gated-skill");
    });

    it("returns false for profile-gated skill when profile disables it", async () => {
      const { skills, profileGatedSkills } = await import("../features.js");
      const { runWithProfile } = await import("../../profiles/profile-context.js");
      profileGatedSkills.add("disabled-skill");

      const result = runWithProfile(testProfile, () => skills.isEnabled("disabled-skill"));
      expect(result).toBe(false);

      profileGatedSkills.delete("disabled-skill");
    });

    it("returns false for profile-gated skill when no profile is active", async () => {
      const { skills, profileGatedSkills } = await import("../features.js");
      profileGatedSkills.add("gated-skill");

      expect(skills.isEnabled("gated-skill")).toBe(false);

      profileGatedSkills.delete("gated-skill");
    });

    it("returns false for unknown skillIds not in static or profile config", async () => {
      const { skills } = await import("../features.js");
      expect(skills.isEnabled("nonexistent")).toBe(false);
    });

    it("static config takes priority over profile flag", async () => {
      process.env.ENABLE_SOCIAL = "false";

      const { skills, profileGatedSkills } = await import("../features.js");
      const { runWithProfile } = await import("../../profiles/profile-context.js");
      profileGatedSkills.add("social");

      const profileWithSocial: ProfileData = {
        name: "social-test",
        description: "Test",
        properties: { "skill.social.enabled": true },
      };
      const result = runWithProfile(profileWithSocial, () => skills.isEnabled("social"));
      expect(result).toBe(false);

      profileGatedSkills.delete("social");
    });

    it("isProfileGated returns true for registered skills", async () => {
      const { skills, profileGatedSkills } = await import("../features.js");
      profileGatedSkills.add("my-skill");

      expect(skills.isProfileGated("my-skill")).toBe(true);

      profileGatedSkills.delete("my-skill");
    });

    it("isProfileGated returns false for unregistered skills", async () => {
      const { skills } = await import("../features.js");
      expect(skills.isProfileGated("unknown")).toBe(false);
    });
  });

  // Pin: the `stripe` skill is always available (static enabledSkills). It is
  // NOT gated at the skill level — its v2 platform-managed tools (setup/status
  // + MCP) are gated at invocation by the `skill.stripe-v2.enabled` profile
  // flag, read in the skill's onLoad hook (agents/src/skills/stripe/tools/index.ts),
  // not here. Everyone else gets the legacy key-paste flow within the same skill.
  describe("stripe enablement", () => {
    it("stripe is always enabled (static config)", async () => {
      const { skills } = await import("../features.js");
      expect(skills.isEnabled("stripe")).toBe(true);
    });

    it("stripe-v2 is no longer a gated skill (folded into stripe; tools gated in onLoad)", async () => {
      const { skills } = await import("../features.js");
      // The separate stripe-v2 skill was removed. Its tools are now registered
      // dynamically by the stripe skill's onLoad based on the profile flag, so
      // stripe-v2 is neither a known enablement nor profile-gated here.
      expect(skills.isProfileGated("stripe-v2")).toBe(false);
      expect(skills.isEnabled("stripe-v2")).toBe(false);
    });

    // Pin: experimental.json must keep `skill.stripe-v2.enabled: true` so the
    // stripe skill's onLoad registers the v2 platform tools for QA shoppers.
    // The flag key retains the `stripe-v2` name for switchboard/profile
    // continuity even though the skill is now `stripe`.
    it("experimental profile keeps skill.stripe-v2.enabled=true (regression pin)", async () => {
      const experimental = (await import("../../profiles/experimental.json", { with: { type: "json" } })).default;
      expect(experimental.properties["skill.stripe-v2.enabled"]).toBe(true);
    });
  });
});

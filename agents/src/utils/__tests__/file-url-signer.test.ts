import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signFileUrl, verifyFileSignature } from "../file-url-signer.js";

describe("File URL Signer", () => {
  const testKey = Buffer.from("a".repeat(32)).toString("base64");
  const originalKey = process.env.GODADDY_OAUTH_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.GODADDY_OAUTH_ENCRYPTION_KEY = testKey;
  });

  afterEach(() => {
    // Restore original env var state to avoid polluting other tests
    if (originalKey === undefined) {
      delete process.env.GODADDY_OAUTH_ENCRYPTION_KEY;
    } else {
      process.env.GODADDY_OAUTH_ENCRYPTION_KEY = originalKey;
    }
    vi.restoreAllMocks();
  });

  describe("signFileUrl", () => {
    it("should return URL with sig and exp query params", () => {
      const url = signFileUrl("app123", "test-file.jpg");
      expect(url).toContain("/files/uploads/app123/test-file.jpg");
      expect(url).toContain("sig=");
      expect(url).toContain("exp=");
    });

    it("should URL-encode special characters in filename", () => {
      const url = signFileUrl("app123", "file with spaces.jpg");
      expect(url).toContain("/files/uploads/app123/file%20with%20spaces.jpg");
    });

    it("should URL-encode special characters in appId", () => {
      const url = signFileUrl("app#123", "test.jpg");
      expect(url).toContain("/files/uploads/app%23123/test.jpg");
    });

    it("should set expiry 24 hours in future", () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      const url = signFileUrl("app123", "test.jpg");
      const expMatch = url.match(/exp=(\d+)/);
      const exp = parseInt(expMatch![1], 10);
      const expectedExp = Math.floor((now + 24 * 60 * 60 * 1000) / 1000);
      expect(exp).toBe(expectedExp);
    });

    it("should generate different signatures for different appIds", () => {
      const url1 = signFileUrl("app1", "file.jpg");
      const url2 = signFileUrl("app2", "file.jpg");
      const sig1 = url1.match(/sig=([^&]+)/)?.[1];
      const sig2 = url2.match(/sig=([^&]+)/)?.[1];
      expect(sig1).not.toBe(sig2);
    });

    it("should generate different signatures for different filenames", () => {
      const url1 = signFileUrl("app1", "file1.jpg");
      const url2 = signFileUrl("app1", "file2.jpg");
      const sig1 = url1.match(/sig=([^&]+)/)?.[1];
      const sig2 = url2.match(/sig=([^&]+)/)?.[1];
      expect(sig1).not.toBe(sig2);
    });

    it("should use base64url encoding for signature", () => {
      const url = signFileUrl("app123", "test.jpg");
      const sig = url.match(/sig=([^&]+)/)?.[1];
      expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe("verifyFileSignature", () => {
    it("should return true for valid signature", () => {
      const url = signFileUrl("app123", "test.jpg");
      const sigMatch = url.match(/sig=([^&]+)/);
      const expMatch = url.match(/exp=(\d+)/);
      expect(sigMatch).not.toBeNull();
      expect(expMatch).not.toBeNull();
      const sig = sigMatch![1];
      const exp = parseInt(expMatch![1], 10);
      const isValid = verifyFileSignature("app123", "test.jpg", sig, exp);
      expect(isValid).toBe(true);
    });

    it("should return false for expired signature", () => {
      const pastExp = Math.floor(Date.now() / 1000) - 3600;
      const isValid = verifyFileSignature("app123", "test.jpg", "any-sig", pastExp);
      expect(isValid).toBe(false);
    });

    it("should return false for tampered signature", () => {
      const url = signFileUrl("app123", "test.jpg");
      const expMatch = url.match(/exp=(\d+)/);
      expect(expMatch).not.toBeNull();
      const exp = parseInt(expMatch![1], 10);
      const isValid = verifyFileSignature("app123", "test.jpg", "tampered-sig", exp);
      expect(isValid).toBe(false);
    });

    it("should return false for wrong appId", () => {
      const url = signFileUrl("app123", "test.jpg");
      const sigMatch = url.match(/sig=([^&]+)/);
      const expMatch = url.match(/exp=(\d+)/);
      expect(sigMatch).not.toBeNull();
      expect(expMatch).not.toBeNull();
      const sig = sigMatch![1];
      const exp = parseInt(expMatch![1], 10);
      const isValid = verifyFileSignature("wrong-app", "test.jpg", sig, exp);
      expect(isValid).toBe(false);
    });

    it("should return false for wrong filename", () => {
      const url = signFileUrl("app123", "test.jpg");
      const sigMatch = url.match(/sig=([^&]+)/);
      const expMatch = url.match(/exp=(\d+)/);
      expect(sigMatch).not.toBeNull();
      expect(expMatch).not.toBeNull();
      const sig = sigMatch![1];
      const exp = parseInt(expMatch![1], 10);
      const isValid = verifyFileSignature("app123", "wrong-file.jpg", sig, exp);
      expect(isValid).toBe(false);
    });
  });
});

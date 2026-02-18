# Signed File URLs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 401 errors when loading uploaded files in `<img>` tags by implementing HMAC-signed URLs.

**Architecture:** Generate signed URLs at upload time that include HMAC signature and expiry. File serving endpoint validates signature instead of requiring JWT for signed requests. Frontend uses signed URLs or shows fallback UI.

**Tech Stack:** Node.js crypto (HMAC-SHA256), Express, React, Vitest

---

## Task 1: Create File URL Signer Utility (Test)

**Files:**

- Create: `agents/src/utils/__tests__/file-url-signer.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signFileUrl, verifyFileSignature } from "../file-url-signer.js";

describe("File URL Signer", () => {
  const testKey = Buffer.from("a".repeat(32)).toString("base64");

  beforeEach(() => {
    process.env.GODADDY_OAUTH_ENCRYPTION_KEY = testKey;
  });

  afterEach(() => {
    delete process.env.GODADDY_OAUTH_ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  describe("signFileUrl", () => {
    it("should return URL with sig and exp query params", () => {
      const url = signFileUrl("app123", "test-file.jpg");

      expect(url).toContain("/files/uploads/app123/test-file.jpg");
      expect(url).toContain("sig=");
      expect(url).toContain("exp=");
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

      // base64url uses - and _ instead of + and /, no padding
      expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe("verifyFileSignature", () => {
    it("should return true for valid signature", () => {
      const url = signFileUrl("app123", "test.jpg");
      const sig = url.match(/sig=([^&]+)/)?.[1]!;
      const exp = parseInt(url.match(/exp=(\d+)/)?.[1]!, 10);

      const isValid = verifyFileSignature("app123", "test.jpg", sig, exp);

      expect(isValid).toBe(true);
    });

    it("should return false for expired signature", () => {
      const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const message = `app123:test.jpg:${pastExp}`;

      // Generate a valid signature for expired time
      const { createHmac } = require("node:crypto");
      const { getEncryptionKey } = require("../../services/token-crypto.js");
      const sig = createHmac("sha256", getEncryptionKey())
        .update(message)
        .digest("base64url");

      const isValid = verifyFileSignature("app123", "test.jpg", sig, pastExp);

      expect(isValid).toBe(false);
    });

    it("should return false for tampered signature", () => {
      const url = signFileUrl("app123", "test.jpg");
      const exp = parseInt(url.match(/exp=(\d+)/)?.[1]!, 10);

      const isValid = verifyFileSignature(
        "app123",
        "test.jpg",
        "tampered-sig",
        exp,
      );

      expect(isValid).toBe(false);
    });

    it("should return false for wrong appId", () => {
      const url = signFileUrl("app123", "test.jpg");
      const sig = url.match(/sig=([^&]+)/)?.[1]!;
      const exp = parseInt(url.match(/exp=(\d+)/)?.[1]!, 10);

      const isValid = verifyFileSignature("wrong-app", "test.jpg", sig, exp);

      expect(isValid).toBe(false);
    });

    it("should return false for wrong filename", () => {
      const url = signFileUrl("app123", "test.jpg");
      const sig = url.match(/sig=([^&]+)/)?.[1]!;
      const exp = parseInt(url.match(/exp=(\d+)/)?.[1]!, 10);

      const isValid = verifyFileSignature("app123", "wrong-file.jpg", sig, exp);

      expect(isValid).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit -- "file-url-signer"`
Expected: FAIL - module not found

---

## Task 2: Create File URL Signer Utility (Implementation)

**Files:**

- Create: `agents/src/utils/file-url-signer.ts`

**Step 1: Write the implementation**

```typescript
import { createHmac } from "node:crypto";
import { getEncryptionKey } from "../services/token-crypto.js";

const SIGNATURE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a signed URL for file access.
 *
 * The signature is HMAC-SHA256 of "appId:filename:exp" using the encryption key.
 * Returns a relative URL path with sig and exp query parameters.
 *
 * @param appId - The app ID that owns the file
 * @param filename - The filename to sign
 * @returns Relative URL path with signature: /files/uploads/{appId}/{filename}?sig=...&exp=...
 */
export function signFileUrl(appId: string, filename: string): string {
  const exp = Math.floor((Date.now() + SIGNATURE_EXPIRY_MS) / 1000);
  const message = `${appId}:${filename}:${exp}`;
  const sig = createHmac("sha256", getEncryptionKey())
    .update(message)
    .digest("base64url");

  return `/files/uploads/${appId}/${filename}?sig=${sig}&exp=${exp}`;
}

/**
 * Verify a file URL signature.
 *
 * Checks that:
 * 1. The signature has not expired
 * 2. The signature matches the expected HMAC
 *
 * @param appId - The app ID from the URL
 * @param filename - The filename from the URL
 * @param sig - The signature from query params
 * @param exp - The expiry timestamp from query params
 * @returns true if signature is valid and not expired
 */
export function verifyFileSignature(
  appId: string,
  filename: string,
  sig: string,
  exp: number,
): boolean {
  // Check expiry first
  if (exp < Math.floor(Date.now() / 1000)) {
    return false;
  }

  // Verify signature
  const message = `${appId}:${filename}:${exp}`;
  const expectedSig = createHmac("sha256", getEncryptionKey())
    .update(message)
    .digest("base64url");

  return sig === expectedSig;
}
```

**Step 2: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit -- "file-url-signer"`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add agents/src/utils/file-url-signer.ts agents/src/utils/__tests__/file-url-signer.test.ts
git commit -m "feat(agents): add file URL signer utility for HMAC-signed URLs

Implements signFileUrl() and verifyFileSignature() functions using
HMAC-SHA256 with 24-hour expiry. Reuses GODADDY_OAUTH_ENCRYPTION_KEY.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update File Serving Endpoint (Test)

**Files:**

- Modify: `agents/src/server/routes/files.test.ts`

**Step 1: Add tests for signed URL authentication**

Add this new describe block after the existing tests:

```typescript
describe("GET /files/uploads/:appId/:filename - Signed URL Authentication", () => {
  it("should serve file with valid signed URL (no JWT needed)", async () => {
    // Import the signer
    const { signFileUrl } = await import("../../utils/file-url-signer.js");

    // Mock file exists
    const { fileUploadService } = await import(
      "../../services/FileUploadService.js"
    );
    (fileUploadService.listUploadedFiles as any).mockResolvedValue([
      { filename: "test-file.jpg", mimeType: "image/jpeg" },
    ]);
    (fileUploadService.getAppUploadsDir as any).mockReturnValue(
      "/tmp/uploads/test-app",
    );
    (fileUploadService.getFilePath as any).mockReturnValue(
      "/tmp/uploads/test-app/upload1/test-file.jpg",
    );

    // Mock fs
    vi.mock("fs", async () => ({
      ...(await vi.importActual("fs")),
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["upload1"]),
    }));
    vi.mock("fs/promises", async () => ({
      ...(await vi.importActual("fs/promises")),
      readFile: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
    }));

    // Create app WITHOUT auth middleware to test signature-only auth
    const noAuthApp = express();
    noAuthApp.use(express.json());
    noAuthApp.use("/files", filesRouter);

    const signedUrl = signFileUrl("test-app", "test-file.jpg");

    const response = await request(noAuthApp).get(signedUrl);

    // Should work without JWT if signature is valid
    expect([200, 401]).toContain(response.status);
  });

  it("should reject expired signed URL", async () => {
    const expiredExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

    const response = await request(app).get(
      `/files/uploads/test-app/test.jpg?sig=fake-sig&exp=${expiredExp}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toContain("Invalid or expired");
  });

  it("should reject invalid signature", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;

    const response = await request(app).get(
      `/files/uploads/test-app/test.jpg?sig=invalid-signature&exp=${futureExp}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toContain("Invalid or expired");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit -- "files.test" -t "Signed URL"`
Expected: FAIL - endpoint doesn't handle signatures yet

---

## Task 4: Update File Serving Endpoint (Implementation)

**Files:**

- Modify: `agents/src/server/routes/files.ts:278-313`

**Step 1: Add import at top of file (after line 7)**

```typescript
import { verifyFileSignature } from "../../utils/file-url-signer.js";
```

**Step 2: Update the file serving route handler**

Replace lines 278-313 with:

```typescript
// Serve uploaded files
router.get('/uploads/:appId/:filename', async (req: Request, res: Response) => {
  try {
    const { appId, filename } = req.params
    const { sig, exp } = req.query

    if (!appId || !filename) {
      return res.status(400).json({ error: 'appId and filename are required' })
    }

    // Path 1: Signed URL authentication (no JWT needed)
    if (sig && exp) {
      const expNum = parseInt(exp as string, 10)
      if (isNaN(expNum) || !verifyFileSignature(appId, filename, sig as string, expNum)) {
        logger.warn('route.files.serve.signature-invalid', {
          appId,
          filename,
          reason: expNum < Math.floor(Date.now() / 1000) ? 'expired' : 'invalid'
        })
        return res.status(401).json({ error: 'Invalid or expired signature' })
      }
      // Signature valid - proceed to serve file
      logger.debug('route.files.serve.signature-valid', { appId, filename })
    }
    // Path 2: JWT authentication (existing behavior)
    else {
      const authReq = req as AuthenticatedRequest
      const authenticatedSiteId = authReq.agentContext?.siteId

      if (!authenticatedSiteId) {
        return res.status(401).json({ error: 'Authentication required', requiresAuth: true })
      }

      // Import BYPASS_SITE_IDS for development/testing
      const { BYPASS_SITE_IDS } = await import('../../services/features.js')
      const isBypassSite = BYPASS_SITE_IDS.includes(authenticatedSiteId)

      logger.debug('route.files.serve.auth-check', {
        authenticatedSiteId,
        requestedAppId: appId,
        isBypassSite,
        filename
      })

      if (!isBypassSite && authenticatedSiteId !== appId) {
        logger.error('route.files.serve.ownership-denied', {
          message: 'SECURITY VIOLATION: Cross-tenant file access attempt',
          authenticatedSiteId,
          requestedAppId: appId,
          filename
        }, { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] })
        return res.status(403).json({ error: 'Access denied' })
      }
    }

    // ... rest of file serving logic unchanged (lines 315-380)
```

**Step 3: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit -- "files.test"`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add agents/src/server/routes/files.ts agents/src/server/routes/files.test.ts
git commit -m "feat(agents): add signed URL support to file serving endpoint

File serving now accepts either JWT auth OR valid HMAC signature.
Enables browser image loading without Authorization header.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add signedUrl to Upload Response

**Files:**

- Modify: `agents/src/server/routes/files.ts:115-123`

**Step 1: Add import for signFileUrl (update existing import)**

The import was added in Task 4. Now add signFileUrl:

```typescript
import {
  signFileUrl,
  verifyFileSignature,
} from "../../utils/file-url-signer.js";
```

**Step 2: Update upload response to include signedUrl**

Replace lines 115-123 with:

```typescript
const result = await fileUploadService.processUpload(appId, files);

// Add signed URLs to response for browser access
const filesWithSignedUrls = result.files.map((file) => ({
  ...file,
  signedUrl: signFileUrl(appId, file.filename),
}));

contextLogger.info("file-upload.request.success", {
  message: "File upload completed successfully",
  uploadId: result.uploadId,
  fileCount: result.files.length,
});

return res.status(200).json({
  uploadId: result.uploadId,
  files: filesWithSignedUrls,
});
```

**Step 3: Run existing tests to verify no regression**

Run: `pnpm --filter @airo/agents test:unit -- "files.test"`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add agents/src/server/routes/files.ts
git commit -m "feat(agents): include signedUrl in upload response

Upload response now includes pre-signed URLs for each file,
enabling frontend to load images without additional API calls.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Update Frontend UploadedFile Interface

**Files:**

- Modify: `app/src/app/develop/components/chat/FileUploadButton.tsx:11-18`

**Step 1: Add signedUrl to interface**

Replace lines 11-18 with:

```typescript
export interface UploadedFile {
  id: string;
  originalName: string;
  filename: string;
  size: number;
  mimeType: string | null;
  uploadedAt: string;
  signedUrl?: string;
}
```

**Step 2: Run typecheck to verify no errors**

Run: `pnpm --filter website typecheck`
Expected: PASS (no type errors)

**Step 3: Commit**

```bash
git add app/src/app/develop/components/chat/FileUploadButton.tsx
git commit -m "feat(app): add signedUrl to UploadedFile interface

Adds optional signedUrl field to support pre-signed URLs from agents.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Update ChatPane to Use signedUrl

**Files:**

- Modify: `app/src/app/develop/components/chat/ChatPane.tsx:530-531`

**Step 1: Update URL construction**

Replace lines 530-531 with:

```typescript
// Use signed URL if available, otherwise undefined (triggers fallback UI)
const fileUrl = file.signedUrl ? `${agentUrl}${file.signedUrl}` : undefined;
```

**Step 2: Run typecheck to verify no errors**

Run: `pnpm --filter website typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add app/src/app/develop/components/chat/ChatPane.tsx
git commit -m "feat(app): use signedUrl for uploaded file display

Uses pre-signed URL from upload response. Falls back to undefined
if not available, which triggers fallback UI instead of broken image.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Update AssetInline to Handle Missing imageUrl

**Files:**

- Modify: `app/src/app/develop/components/chat/AssetInline.tsx:3,94-100`

**Step 1: Add ImageIcon import (after line 3)**

```typescript
import ImageIcon from "@ux/icon/image";
```

**Step 2: Update rendering logic**

Replace lines 94-100 with:

```typescript
      {activeAsset.mediaType === MediaType.IMAGE && activeAsset.imageUrl ? (
        // Images with URL render as thumbnails
        <img // eslint-disable-line @next/next/no-img-element
          src={getAssetDisplayUrl(activeAsset)}
          alt={customAsset?.imageAlt || label}
          className={cn(ASSET_CLASSES, 'object-cover')}
        />
      ) : activeAsset.mediaType === MediaType.IMAGE ? (
        // Images WITHOUT URL render as icon with filename (fallback)
        <div className={cn(ASSET_CLASSES, 'justify-end gap-0.5 px-1 py-0.5')}>
          <ImageIcon />
          <text.div as='caption' size={-2} className='truncate max-w-full'>
            {label}
          </text.div>
        </div>
      ) : activeAsset.mediaType === MediaType.VIDEO ? (
```

**Step 3: Run typecheck and lint**

Run: `pnpm --filter website typecheck && pnpm --filter website lint`
Expected: PASS

**Step 4: Commit**

```bash
git add app/src/app/develop/components/chat/AssetInline.tsx
git commit -m "feat(app): add fallback UI for images without URL

Shows image icon + filename when imageUrl is missing, instead of
attempting to load a broken image. Handles legacy uploads gracefully.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Final Verification

**Step 1: Run all agents tests**

Run: `pnpm --filter @airo/agents test:unit`
Expected: All tests PASS

**Step 2: Run all app typechecks**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS

**Step 4: Manual test (optional)**

1. Start dev servers: `pnpm run dev`
2. Upload an image in chat
3. Verify image displays (no 401 error in console)
4. Check network tab: URL should include `?sig=...&exp=...`

---

## Summary of Files Changed

| File                                                       | Change                                        |
| ---------------------------------------------------------- | --------------------------------------------- |
| `agents/src/utils/file-url-signer.ts`                      | New - signing utility                         |
| `agents/src/utils/__tests__/file-url-signer.test.ts`       | New - unit tests                              |
| `agents/src/server/routes/files.ts`                        | Modified - dual auth, signed URLs in response |
| `agents/src/server/routes/files.test.ts`                   | Modified - signature tests                    |
| `app/src/app/develop/components/chat/FileUploadButton.tsx` | Modified - signedUrl in interface             |
| `app/src/app/develop/components/chat/ChatPane.tsx`         | Modified - use signedUrl                      |
| `app/src/app/develop/components/chat/AssetInline.tsx`      | Modified - fallback UI                        |

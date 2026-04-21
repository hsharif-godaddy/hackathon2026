# Persistent File Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move chat file uploads from ephemeral container-local storage to persistent private Ceph storage, simplify heuristic filename resolution to exact-match, and remove the 24h expiry/cleanup system.

**Architecture:** All uploads write to persistent private storage (`/private/uploads` in production, `{appPath}/../assets/private/uploads` in local dev). The `UPLOAD_DIR` env var remains the source of truth. Resolution changes from heuristic scoring to exact-match on `originalName`/`filename`. The cleanup service and expiry mechanism are removed entirely.

**Tech Stack:** TypeScript, Express, Vitest, Zod

**Spec:** `docs/superpowers/specs/2026-04-09-persistent-file-uploads-design.md`

---

### Task 1: Update `features.ts` upload directory default

The `features.ts` default for `uploadDir` changes from `'data/uploads'` to use `getPersistentPrivateDir()` for local dev. Production always has `UPLOAD_DIR` set explicitly via `agent.libsonnet`.

**Files:**

- Modify: `agents/src/services/features.ts:1-5` (imports), `agents/src/services/features.ts:204` (default value)

- [ ] **Step 1: Write the failing test**

Create test file `agents/src/services/__tests__/features-upload-dir.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("features.ts uploadDir default", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.UPLOAD_DIR;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should use UPLOAD_DIR env var when set", async () => {
    process.env.UPLOAD_DIR = "/private/uploads";
    const { getFeatures } = await import("../features.js");
    expect(getFeatures().uploadDir).toBe("/private/uploads");
  });

  it("should fall back to persistent private dir when CUSTOMER_APP_DIR is set", async () => {
    delete process.env.UPLOAD_DIR;
    process.env.CUSTOMER_APP_DIR = "/app";
    const { getFeatures } = await import("../features.js");
    // getPersistentPrivateDir('/app') returns '/private'
    expect(getFeatures().uploadDir).toBe("/private/uploads");
  });

  it("should fall back to persistent private dir for local dev path", async () => {
    delete process.env.UPLOAD_DIR;
    process.env.CUSTOMER_APP_DIR = "/tmp/airo-app-builder/abc123/preview";
    const { getFeatures } = await import("../features.js");
    expect(getFeatures().uploadDir).toBe(
      "/tmp/airo-app-builder/abc123/assets/private/uploads",
    );
  });

  it("should fall back to data/uploads when neither UPLOAD_DIR nor CUSTOMER_APP_DIR is set", async () => {
    delete process.env.UPLOAD_DIR;
    delete process.env.CUSTOMER_APP_DIR;
    const { getFeatures } = await import("../features.js");
    expect(getFeatures().uploadDir).toBe("data/uploads");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "features-upload-dir"`
Expected: FAIL - tests expecting persistent private dir paths will fail because current default is `'data/uploads'`.

- [ ] **Step 3: Update features.ts**

In `agents/src/services/features.ts`, add import at the top:

```typescript
import { getPersistentPrivateDir } from "../utils/persistent-assets.js";
```

Then replace line 204:

```typescript
// Before:
uploadDir: process.env.UPLOAD_DIR || 'data/uploads',

// After:
uploadDir: process.env.UPLOAD_DIR || (
  process.env.CUSTOMER_APP_DIR
    ? getPersistentPrivateDir(process.env.CUSTOMER_APP_DIR) + '/uploads'
    : 'data/uploads'
),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "features-upload-dir"`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add agents/src/services/features.ts agents/src/services/__tests__/features-upload-dir.test.ts
git commit -m "feat: update uploadDir default to use persistent private storage

When UPLOAD_DIR env var is not set but CUSTOMER_APP_DIR is available,
fall back to getPersistentPrivateDir() + '/uploads' instead of
'data/uploads'. Production always has UPLOAD_DIR set explicitly."
```

---

### Task 2: Remove expiry from `FileUploadService`

Remove `UPLOAD_EXPIRY_HOURS`, `expiresAt` computation in `processUpload()`, make `expiresAt` optional in `MetadataSchema` and `UploadResult`, and delete `deleteExpiredUploads()`.

**Files:**

- Modify: `agents/src/services/FileUploadService.ts:29-35` (UploadResult), `agents/src/services/FileUploadService.ts:77` (UPLOAD_EXPIRY_HOURS), `agents/src/services/FileUploadService.ts:90-97` (MetadataSchema), `agents/src/services/FileUploadService.ts:271-394` (processUpload), `agents/src/services/FileUploadService.ts:590-656` (deleteExpiredUploads)
- Modify: `app/src/types/file-upload.ts:14` (client UploadResult)

- [ ] **Step 1: Write the failing test**

Create test file `agents/src/services/__tests__/FileUploadService-no-expiry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { FileUploadService } from "../FileUploadService.js";

describe("FileUploadService - no expiry", () => {
  const testDir = "/tmp/test-uploads-no-expiry";
  let service: FileUploadService;

  beforeEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
    service = new FileUploadService(testDir);
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("should not include expiresAt in upload result", async () => {
    const file = {
      originalname: "test.txt",
      mimetype: "text/plain",
      size: 4,
      buffer: Buffer.from("test"),
    } as Express.Multer.File;

    const result = await service.processUpload("app1", [file]);
    expect(result.expiresAt).toBeUndefined();
  });

  it("should not include expiresAt in metadata.json", async () => {
    const file = {
      originalname: "test.txt",
      mimetype: "text/plain",
      size: 4,
      buffer: Buffer.from("test"),
    } as Express.Multer.File;

    const result = await service.processUpload("app1", [file]);
    const metadataPath = service.getFilePath(
      "app1",
      result.uploadId,
      "metadata.json",
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf-8"));
    expect(metadata.expiresAt).toBeUndefined();
    expect(metadata.uploadedAt).toBeDefined();
  });

  it("should not have deleteExpiredUploads method", () => {
    expect((service as any).deleteExpiredUploads).toBeUndefined();
  });

  it("should parse old metadata with expiresAt field (backward compat)", async () => {
    // listUploadedFiles validates metadata with Zod - ensure old metadata still parses
    const file = {
      originalname: "test.txt",
      mimetype: "text/plain",
      size: 4,
      buffer: Buffer.from("test"),
    } as Express.Multer.File;

    const result = await service.processUpload("app1", [file]);

    // Manually inject expiresAt into metadata to simulate old format
    const metadataPath = service.getFilePath(
      "app1",
      result.uploadId,
      "metadata.json",
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf-8"));
    metadata.expiresAt = new Date(Date.now() + 86400000).toISOString();
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(metadataPath, JSON.stringify(metadata, null, 2));

    // Should still parse successfully
    const files = await service.listUploadedFiles("app1");
    expect(files.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "FileUploadService-no-expiry"`
Expected: FAIL - `expiresAt` is still present in result, and `deleteExpiredUploads` still exists.

- [ ] **Step 3: Modify FileUploadService.ts**

**3a. Remove `UPLOAD_EXPIRY_HOURS` constant (line 77):**
Delete the line:

```typescript
const UPLOAD_EXPIRY_HOURS = 24;
```

**3b. Make `expiresAt` optional in `UploadResult` (lines 29-35):**

```typescript
export interface UploadResult {
  uploadId: string;
  appId: string;
  files: UploadedFile[];
  failedFiles: FailedFile[];
  expiresAt?: string;
}
```

**3c. Make `expiresAt` optional in `MetadataSchema` (lines 90-97):**

```typescript
const MetadataSchema = z.object({
  uploadId: z.string(),
  appId: z.string(),
  uploadedAt: z.string(),
  expiresAt: z.string().optional(),
  fileCount: z.number().int().nonnegative(),
  files: z.array(UploadedFileSchema),
});
```

**3d. Remove `expiresAt` from `processUpload()` (lines 271-394):**

Remove line 285:

```typescript
const expiresAt = new Date(
  Date.now() + UPLOAD_EXPIRY_HOURS * 60 * 60 * 1000,
).toISOString();
```

Remove `expiresAt` from the metadata object at line 355:

```typescript
// Before:
const metadata = {
  uploadId,
  appId,
  uploadedAt,
  expiresAt,
  fileCount: uploadedFiles.length,
  files: uploadedFiles,
};

// After:
const metadata = {
  uploadId,
  appId,
  uploadedAt,
  fileCount: uploadedFiles.length,
  files: uploadedFiles,
};
```

Remove `expiresAt` from the return at line 387-393:

```typescript
// Before:
return {
  uploadId,
  appId,
  files: uploadedFiles,
  failedFiles,
  expiresAt,
};

// After:
return {
  uploadId,
  appId,
  files: uploadedFiles,
  failedFiles,
};
```

**3e. Delete `deleteExpiredUploads()` method entirely (lines 590-656).**

**3f. Make `expiresAt` optional in client type `app/src/types/file-upload.ts`:**

```typescript
// Before:
export interface UploadResult {
  uploadId: string;
  appId: string;
  files: UploadedFileMetadata[];
  expiresAt: string;
}

// After:
export interface UploadResult {
  uploadId: string;
  appId: string;
  files: UploadedFileMetadata[];
  expiresAt?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "FileUploadService-no-expiry"`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Run existing tests to check for regressions**

Run: `pnpm --filter @airo/agents test:unit "FileUploadService"`
Expected: PASS (existing file-type validation tests should still pass)

- [ ] **Step 6: Commit**

```bash
git add agents/src/services/FileUploadService.ts app/src/types/file-upload.ts agents/src/services/__tests__/FileUploadService-no-expiry.test.ts
git commit -m "feat: remove upload expiry from FileUploadService

Remove UPLOAD_EXPIRY_HOURS, expiresAt computation, and
deleteExpiredUploads(). Make expiresAt optional in MetadataSchema
and UploadResult for backward compat with existing metadata files."
```

---

### Task 3: Remove `FileCleanupService` and `upload-resolution-tracking`

Remove the hourly cleanup service and the extension-based resolution tracking. Both are no longer needed.

**Files:**

- Delete: `agents/src/services/FileCleanupService.ts`
- Delete: `agents/src/utils/upload-resolution-tracking.ts`
- Delete: `agents/src/utils/__tests__/upload-resolution-tracking.test.ts`
- Modify: `agents/src/server/app.ts:186,521,637` (remove FileCleanupService import and start/stop)
- Modify: `agents/src/services/FileUploadService.ts:13,385,692` (remove clearExtensionResolved import and calls)
- Modify: `agents/src/tools/file-edit.ts:15` (remove pickAndMarkExtensionResolved import)
- Modify: `agents/src/tools/file-edit.test.ts:4` (remove clearExtensionResolved import and usage)

- [ ] **Step 1: Remove FileCleanupService from app.ts**

In `agents/src/server/app.ts`:

- Delete the import at line 186: `import { fileCleanupService } from '../services/FileCleanupService.js';`
- Delete `fileCleanupService.start();` at line 521
- Delete `fileCleanupService.stop()` at line 637

- [ ] **Step 2: Remove clearExtensionResolved from FileUploadService.ts**

In `agents/src/services/FileUploadService.ts`:

- Remove import of `clearExtensionResolved` (line 13)
- Remove `clearExtensionResolved(appId)` call at line 385 (in `processUpload()`)
- Remove `clearExtensionResolved(appId)` call at line 692 (in `cleanupAppUploads()` finally block)

- [ ] **Step 3: Delete the files**

```bash
rm agents/src/services/FileCleanupService.ts
rm agents/src/utils/upload-resolution-tracking.ts
rm agents/src/utils/__tests__/upload-resolution-tracking.test.ts
```

- [ ] **Step 4: Inline `pickAndMarkExtensionResolved` in file-edit.ts temporarily**

Since `file-edit.ts` still calls `pickAndMarkExtensionResolved` (will be removed in Task 4) and `file-edit.test.ts` imports `clearExtensionResolved`, we need to:

In `agents/src/tools/file-edit.ts`:

- Replace import at line 15 with a local stub:

```typescript
// Temporary stub - removed in Task 4 when resolveSourceFile is simplified
function pickAndMarkExtensionResolved(
  _appId: string,
  candidates: import("../services/FileUploadService.js").UploadedFile[],
  compareFn: (a: any, b: any) => number,
) {
  const sorted = [...candidates].sort(compareFn);
  return sorted[0] ?? null;
}
```

In `agents/src/tools/file-edit.test.ts`:

- Remove import at line 4: `import { clearExtensionResolved } from '../utils/upload-resolution-tracking.js';`
- Remove `clearExtensionResolved(testAppId);` call in beforeEach (line 21)

(Both the stub and the old tests will be fully replaced in Tasks 4 and 5.)

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS (no references to deleted files remain)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: remove FileCleanupService and upload-resolution-tracking

FileCleanupService hourly expiry cleanup is no longer needed since
uploads are now persistent. Upload-resolution-tracking race condition
prevention is no longer needed since heuristic matching is being
replaced with exact-match in the next commit."
```

---

### Task 4: Simplify `resolveSourceFile()` to exact-match (standalone export)

Replace the heuristic matching in the standalone `resolveSourceFile()` function (used by `text-editor.ts`) with exact-match only.

**Files:**

- Modify: `agents/src/tools/file-edit.ts:1650-1828` (standalone resolveSourceFile, scoreNameSimilarity, compareByUploadDate)

- [ ] **Step 1: Write the failing test**

Create test file `agents/src/tools/__tests__/resolve-source-file.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { resolveSourceFile } from "../file-edit.js";
import { fileUploadService } from "../../services/FileUploadService.js";

describe("resolveSourceFile - exact match only", () => {
  const testAppId = "test-app-exact-match";
  const testProjectDir = `/tmp/test-project-resolve/${testAppId}`;

  async function seedUpload(
    originalName: string,
    content: string | Buffer,
  ): Promise<string> {
    const file = {
      originalname: originalName,
      mimetype: originalName.endsWith(".png") ? "image/png" : "text/plain",
      size:
        typeof content === "string"
          ? Buffer.byteLength(content)
          : content.length,
      buffer: typeof content === "string" ? Buffer.from(content) : content,
    } as Express.Multer.File;
    const result = await fileUploadService.processUpload(testAppId, [file]);
    return result.uploadId;
  }

  beforeEach(async () => {
    for (const dir of [testProjectDir]) {
      if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
    }
    const testAppUploadsDir = fileUploadService["pathBuilder"].join(testAppId);
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }
    const testAppUploadsDir = fileUploadService["pathBuilder"].join(testAppId);
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true });
    }
  });

  it("should resolve when target filename matches originalName exactly", async () => {
    await seedUpload("logo.png", Buffer.from("PNG_DATA"));
    const result = await resolveSourceFile(
      testAppId,
      "public/assets/logo.png",
      "",
      join(testProjectDir, "public/assets/logo.png"),
    );
    expect(result).not.toBeNull();
    expect(result!.binaryCopied).toBe(true);
  });

  it("should NOT resolve when filenames differ only by name (same extension)", async () => {
    await seedUpload("hero-image.jpg", Buffer.from("JPEG_DATA"));
    // Agent uses different name with same extension - should fail
    const result = await resolveSourceFile(
      testAppId,
      "public/assets/banner.jpg",
      "",
      join(testProjectDir, "public/assets/banner.jpg"),
    );
    expect(result).toBeNull();
  });

  it("should return null when content is not empty", async () => {
    await seedUpload("logo.png", Buffer.from("PNG_DATA"));
    const result = await resolveSourceFile(
      testAppId,
      "public/assets/logo.png",
      "some content",
    );
    expect(result).toBeNull();
  });

  it("should return null when no uploads exist", async () => {
    const result = await resolveSourceFile(
      testAppId,
      "public/assets/logo.png",
      "",
    );
    expect(result).toBeNull();
  });

  it("should resolve text files by reading content", async () => {
    await seedUpload("data.json", '{"key": "value"}');
    const result = await resolveSourceFile(
      testAppId,
      "public/data/data.json",
      "",
    );
    expect(result).not.toBeNull();
    expect(result!.content).toBe('{"key": "value"}');
    expect(result!.binaryCopied).toBeUndefined();
  });

  it("should match on stored filename as well as originalName", async () => {
    // processUpload generates stored filename like {appId}_{timestamp}_{fileId}.ext
    // resolveSourceFile should also match against the stored filename
    await seedUpload("logo.png", Buffer.from("PNG_DATA"));
    const files = await fileUploadService.listUploadedFiles(testAppId);
    const storedFilename = files[0]!.filename;

    const result = await resolveSourceFile(
      testAppId,
      `public/assets/${storedFilename}`,
      "",
      join(testProjectDir, `public/assets/${storedFilename}`),
    );
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "resolve-source-file"`
Expected: FAIL - the test for "should NOT resolve when filenames differ" will pass with old heuristic code (it would resolve via extension matching). Wait - it should actually fail because we removed `pickAndMarkExtensionResolved` import in Task 3. If Task 3 is already done, this will be a compile error. If running tests before Task 3, the "should NOT resolve" test will fail (heuristic incorrectly resolves it).

- [ ] **Step 3: Rewrite standalone resolveSourceFile() to exact-match**

In `agents/src/tools/file-edit.ts`, replace the standalone `resolveSourceFile()` function (lines 1687-1828) and delete `scoreNameSimilarity()` (lines 1663-1678) and `compareByUploadDate()` (lines 1650-1657):

Delete `compareByUploadDate()` (lines 1650-1657) and `scoreNameSimilarity()` (lines 1663-1678).

Replace the standalone `resolveSourceFile()` (lines 1687-1828) with:

```typescript
export async function resolveSourceFile(
  appId: string,
  targetPath: string,
  content: string,
  fullTargetPath?: string,
): Promise<{ content: string; binaryCopied?: boolean } | null> {
  try {
    const filename = basename(targetPath);

    if (content !== "") {
      return null;
    }

    const uploadedFiles = await fileUploadService.listUploadedFiles(appId);

    if (uploadedFiles.length === 0) {
      logger.debug("file-edit.auto-resolve.no-uploads", { appId, filename });
      return null;
    }

    // Exact match only: originalName or stored filename
    const matchingFile =
      uploadedFiles.find(
        (f) => f.originalName === filename || f.filename === filename,
      ) ?? null;

    if (!matchingFile) {
      logger.info("file-edit.auto-resolve.no-exact-match", {
        appId,
        requestedFilename: filename,
        availableFiles: uploadedFiles.map((f) => f.originalName),
      });
      return null;
    }

    // Find the source file on disk
    let sourcePath: string | null = null;
    const appUploadsDir = fileUploadService["pathBuilder"].join(appId);

    if (existsSync(appUploadsDir)) {
      const { readdirSync } = await import("node:fs");
      const uploadDirs = readdirSync(appUploadsDir);

      for (const uploadId of uploadDirs) {
        const candidatePath = fileUploadService.getFilePath(
          appId,
          uploadId,
          matchingFile.filename,
        );
        if (existsSync(candidatePath)) {
          sourcePath = candidatePath;
          break;
        }
      }
    }

    if (!sourcePath || !existsSync(sourcePath)) {
      logger.warn("file-edit.auto-resolve.source-missing", {
        appId,
        filename,
        matchingFile: matchingFile.filename,
      });
      return null;
    }

    const isBinary =
      BINARY_FILE_REGEX.test(filename) &&
      !filename.toLowerCase().endsWith(".svg");

    if (isBinary && fullTargetPath) {
      await mkdir(dirname(fullTargetPath), { recursive: true });
      await writeFile(fullTargetPath, await readFile(sourcePath));

      logger.info("file-edit.auto-resolved", {
        appId,
        filename,
        originalName: matchingFile.originalName,
        from: sourcePath,
        size: matchingFile.size,
        binary: true,
      });

      return { content: "", binaryCopied: true };
    }

    logger.info("file-edit.auto-resolved", {
      appId,
      filename,
      originalName: matchingFile.originalName,
      from: sourcePath,
      size: matchingFile.size,
    });

    return { content: await readFile(sourcePath, "utf-8") };
  } catch (error) {
    logger.error("file-edit.auto-resolve.error", {
      appId,
      targetPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "resolve-source-file"`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add agents/src/tools/file-edit.ts agents/src/tools/__tests__/resolve-source-file.test.ts
git commit -m "feat: simplify standalone resolveSourceFile to exact-match

Replace heuristic name-similarity scoring and extension fallback with
exact match on originalName or stored filename. Remove scoreNameSimilarity()
and compareByUploadDate() helpers. Non-matching resolution now logs
available filenames for debugging."
```

---

### Task 5: Simplify class method `resolveSourceFile()` to exact-match

The `FileEditTool` class has its own private `resolveSourceFile()` method with identical heuristic logic. Simplify it to exact-match as well.

**Files:**

- Modify: `agents/src/tools/file-edit.ts:712-858` (class method resolveSourceFile)
- Modify: `agents/src/tools/file-edit.test.ts` (rewrite tests for exact-match behavior)

- [ ] **Step 1: Rewrite existing file-edit.test.ts for exact-match behavior**

Replace the test content in `agents/src/tools/file-edit.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileEditTool } from "./file-edit.js";
import { fileUploadService } from "../services/FileUploadService.js";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

describe("FileEditTool - Auto Resolution from Uploads", () => {
  const testAppId = "test-app-resolution";
  const testProjectDir = `/tmp/test-project-file-edit/${testAppId}`;
  const tool = new FileEditTool();

  beforeEach(async () => {
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }
    await mkdir(testProjectDir, { recursive: true });

    const testAppUploadsDir = fileUploadService["pathBuilder"].join(testAppId);
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }
    const testAppUploadsDir = fileUploadService["pathBuilder"].join(testAppId);
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true });
    }
  });

  async function seedUpload(name: string, content: Buffer) {
    const file = {
      originalname: name,
      mimetype: name.endsWith(".png")
        ? "image/png"
        : "application/octet-stream",
      size: content.length,
      buffer: content,
    } as Express.Multer.File;
    return fileUploadService.processUpload(testAppId, [file]);
  }

  it("should resolve file when target matches originalName exactly", async () => {
    const imageData = Buffer.from("FAKE_PNG_DATA");
    await seedUpload("logo.png", imageData);

    const resolved = await (tool as any).resolveSourceFile(
      testAppId,
      "public/assets/logo.png",
      testProjectDir,
    );

    expect(resolved).toBe(true);
    const targetPath = join(testProjectDir, "public/assets/logo.png");
    expect(existsSync(targetPath)).toBe(true);
    expect(readFile(targetPath)).resolves.toEqual(imageData);
  });

  it("should NOT resolve when filename differs (no heuristic matching)", async () => {
    await seedUpload("hero-image.jpg", Buffer.from("JPEG"));

    const resolved = await (tool as any).resolveSourceFile(
      testAppId,
      "public/assets/banner.jpg",
      testProjectDir,
    );

    expect(resolved).toBe(false);
  });

  it("should return false when no uploads exist", async () => {
    const resolved = await (tool as any).resolveSourceFile(
      testAppId,
      "public/assets/logo.png",
      testProjectDir,
    );

    expect(resolved).toBe(false);
  });

  it("should overwrite existing file when exact match found", async () => {
    const targetPath = join(testProjectDir, "public/assets/logo.png");
    await mkdir(join(testProjectDir, "public/assets"), { recursive: true });
    await writeFile(targetPath, "OLD_DATA");

    const newData = Buffer.from("NEW_PNG_DATA");
    await seedUpload("logo.png", newData);

    const resolved = await (tool as any).resolveSourceFile(
      testAppId,
      "public/assets/logo.png",
      testProjectDir,
    );

    expect(resolved).toBe(true);
    expect(readFile(targetPath)).resolves.toEqual(newData);
  });
});
```

- [ ] **Step 2: Run test to verify "NOT resolve" test fails with old code**

Run: `pnpm --filter @airo/agents test:unit "file-edit.test"`
Expected: The "should NOT resolve when filename differs" test may fail if the old extension-matching code is still present. (If Task 3 already removed the import, it will be a compile error instead.)

- [ ] **Step 3: Rewrite class method resolveSourceFile()**

Replace the class method at lines 712-858 in `agents/src/tools/file-edit.ts`:

```typescript
  private async resolveSourceFile(
    appId: string,
    targetPath: string,
    appBasePath: string
  ): Promise<boolean> {
    try {
      const filename = basename(targetPath);
      const pathBuilder = createSafePathBuilder(appBasePath);
      const fullTargetPath = pathBuilder.join(targetPath);

      const uploadedFiles = await fileUploadService.listUploadedFiles(appId);

      if (uploadedFiles.length === 0) {
        logger.debug('file-edit.auto-resolve.no-uploads', { appId, filename });
        return false;
      }

      // Exact match only: originalName or stored filename
      const matchingFile = uploadedFiles.find(
        f => f.originalName === filename || f.filename === filename
      ) ?? null;

      if (!matchingFile) {
        logger.info('file-edit.auto-resolve.no-exact-match', {
          appId,
          requestedFilename: filename,
          availableFiles: uploadedFiles.map(f => f.originalName)
        });
        return false;
      }

      // Find the source file on disk
      let sourcePath: string | null = null;
      const appUploadsDir = fileUploadService['pathBuilder'].join(appId);

      if (existsSync(appUploadsDir)) {
        const { readdirSync } = await import('fs');
        const uploadDirs = readdirSync(appUploadsDir);

        for (const uploadId of uploadDirs) {
          const candidatePath = fileUploadService.getFilePath(appId, uploadId, matchingFile.filename);
          if (existsSync(candidatePath)) {
            sourcePath = candidatePath;
            break;
          }
        }
      }

      if (!sourcePath || !existsSync(sourcePath)) {
        logger.warn('file-edit.auto-resolve.source-missing', {
          appId,
          filename,
          matchingFile: matchingFile.filename
        });
        return false;
      }

      await mkdir(dirname(fullTargetPath), { recursive: true });
      const sourceContent = await readFile(sourcePath);
      await writeFile(fullTargetPath, sourceContent);

      logger.info('file-edit.auto-resolved', {
        appId,
        filename,
        originalName: matchingFile.originalName,
        from: sourcePath,
        to: fullTargetPath,
        size: matchingFile.size
      });

      return true;
    } catch (error) {
      logger.error('file-edit.auto-resolve.error', {
        appId,
        targetPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "file-edit.test"`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Run full test suite**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add agents/src/tools/file-edit.ts agents/src/tools/file-edit.test.ts
git commit -m "feat: simplify FileEditTool.resolveSourceFile to exact-match

Replace heuristic matching in the class method with exact match on
originalName or stored filename, consistent with the standalone export."
```

---

### Task 6: Refactor `readUploadedFileContent()` to use `fileUploadService`

Currently duplicates path resolution logic from `features.uploadDir`. Refactor to use `fileUploadService.listUploadedFiles()` and `fileUploadService.getFilePath()` so it automatically follows the new root directory.

**Files:**

- Modify: `agents/src/services/helpers/ContextFormatter.ts:34-146` (readUploadedFileContent)

- [ ] **Step 1: Write the failing test**

Check existing tests first. The existing test file at `agents/src/services/helpers/__tests__/ContextFormatter.test.ts` already mocks `fileUploadService` for `readAgentUploadAsBase64()`. Add tests for the refactored `readUploadedFileContent()`:

Add to `agents/src/services/helpers/__tests__/ContextFormatter.test.ts` (or create a new describe block):

```typescript
describe("readUploadedFileContent", () => {
  it("should use fileUploadService to resolve file path", async () => {
    const { fileUploadService } = await import(
      "../../../services/FileUploadService.js"
    );
    const { readUploadedFileContent } = await import("../ContextFormatter.js");

    vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
      {
        id: "file1",
        originalName: "data.json",
        filename: "app1_123_file1.json",
        size: 100,
        mimeType: "application/json",
        uploadedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(fileUploadService.getFilePath).mockReturnValue(
      "/uploads/app1/upload_1/app1_123_file1.json",
    );

    // The function should call fileUploadService methods, not construct paths manually
    const result = await readUploadedFileContent(
      "http://localhost:4000/files/uploads/app1/data.json",
      "data.json",
    );

    expect(vi.mocked(fileUploadService.listUploadedFiles)).toHaveBeenCalledWith(
      "app1",
    );
  });
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `pnpm --filter @airo/agents test:unit "ContextFormatter"`
Expected: Check current test state. If existing tests pass, the new test may also pass if the mock is wired correctly. The key verification is that `readUploadedFileContent` now calls `fileUploadService.listUploadedFiles()` instead of manually constructing paths.

- [ ] **Step 3: Refactor readUploadedFileContent()**

Replace `readUploadedFileContent()` in `agents/src/services/helpers/ContextFormatter.ts` (lines 34-146):

```typescript
export async function readUploadedFileContent(
  imageUrl: string,
  filename: string,
): Promise<string | null> {
  try {
    const urlMatch = imageUrl.match(/\/files\/uploads\/([^/]+)\/[^/]+$/);
    if (!urlMatch || !urlMatch[1]) {
      logger.warn("context.formatter.file_read.invalid_url", {
        imageUrl,
        reason: "Could not extract appId from URL",
      });
      return null;
    }

    const appId = urlMatch[1];
    const { fileUploadService } = await import("../FileUploadService.js");

    const uploadedFiles = await fileUploadService.listUploadedFiles(appId);
    const fileEntry = uploadedFiles.find((f) => f.originalName === filename);

    if (!fileEntry) {
      logger.warn("context.formatter.file_read.not_found", {
        appId,
        filename,
        availableFiles: uploadedFiles.map((f) => f.originalName),
      });
      return null;
    }

    // Find the file on disk by scanning upload directories
    const appUploadsDir = fileUploadService["pathBuilder"].join(appId);
    const { readdirSync } = await import("node:fs");

    if (!existsSync(appUploadsDir)) {
      logger.warn("context.formatter.file_read.directory_missing", { appId });
      return null;
    }

    const uploadDirs = readdirSync(appUploadsDir);
    let filePath: string | null = null;

    for (const uploadId of uploadDirs) {
      const candidatePath = fileUploadService.getFilePath(
        appId,
        uploadId,
        fileEntry.filename,
      );
      if (existsSync(candidatePath)) {
        filePath = candidatePath;
        break;
      }
    }

    if (!filePath) {
      logger.warn("context.formatter.file_read.source_missing", {
        appId,
        filename,
        storedFilename: fileEntry.filename,
      });
      return null;
    }

    const content = await readFile(filePath, "utf-8");

    const maxSizeBytes = 100 * 1024;
    if (content.length > maxSizeBytes) {
      const truncated = content.substring(0, maxSizeBytes);
      logger.info("context.formatter.file_read.truncated", {
        appId,
        filename,
        originalSize: content.length,
        truncatedSize: maxSizeBytes,
      });
      return truncated + "\n\n[Content truncated - file too large]";
    }

    logger.info("context.formatter.file_read.success", {
      appId,
      filename,
      actualFilename: fileEntry.filename,
      size: content.length,
    });

    return content;
  } catch (error) {
    logger.error("context.formatter.file_read.error", {
      imageUrl,
      filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
```

Also remove the now-unused imports from the top of the file. The old function imported `getFeatures` and `join`/`normalize`/`resolve` for manual path construction. After the refactor, these may no longer be needed (check what `readAgentUploadAsBase64` uses before removing).

- [ ] **Step 4: Run tests to verify**

Run: `pnpm --filter @airo/agents test:unit "ContextFormatter"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/src/services/helpers/ContextFormatter.ts agents/src/services/helpers/__tests__/ContextFormatter.test.ts
git commit -m "refactor: use fileUploadService in readUploadedFileContent

Replace manual path construction via features.uploadDir with
fileUploadService.listUploadedFiles() and getFilePath(). Ensures
the function automatically follows the new upload root directory."
```

---

### Task 7: Simplify upload instructions in `SelectedAssetsContextRenderer`

Replace the verbose auto-resolution prompt with a shorter instruction that tells the agent to use exact filenames.

**Files:**

- Modify: `agents/src/services/renderers/SelectedAssetsContextRenderer.ts:106-127`

- [ ] **Step 1: Replace the prompt section**

In `agents/src/services/renderers/SelectedAssetsContextRenderer.ts`, replace lines 116-127:

```typescript
// Before:
parts.push("");
parts.push("⚠️ UPLOADED FILE - AUTO-RESOLUTION ENABLED");
parts.push("");
parts.push(
  '**CRITICAL**: Use file_edit with mode="create" and content="" (empty string)',
);
parts.push(
  "- The empty content is intentional - the system will automatically copy the uploaded file",
);
parts.push(
  `- Suggested: file_edit({ path: "${projectPath}", mode: "create", content: "" })`,
);
if (asset.mediaType === "IMAGE") {
  parts.push(`- Reference: <img src="${refPath}" alt="description" />`);
} else {
  parts.push(`- Reference: <a href="${refPath}">Download PDF</a>`);
}

// After:
parts.push("");
parts.push("UPLOADED FILE - To use in project:");
parts.push(
  `- file_edit({ path: "${projectPath}", mode: "create", content: "" })`,
);
parts.push(
  `- Target filename MUST exactly match "${filename}" for auto-resolution`,
);
if (asset.mediaType === "IMAGE") {
  parts.push(`- Reference: <img src="${refPath}" alt="description" />`);
} else {
  parts.push(`- Reference: <a href="${refPath}">Download PDF</a>`);
}
parts.push("- NEVER reference /files/uploads/ URLs in code");
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @airo/agents test:unit "SelectedAssets"`
Expected: PASS (or check if tests exist for this renderer and update assertions if needed)

- [ ] **Step 3: Commit**

```bash
git add agents/src/services/renderers/SelectedAssetsContextRenderer.ts
git commit -m "feat: simplify upload instructions to require exact filename match

Replace verbose UPLOADED FILE - AUTO-RESOLUTION prompt with shorter
instructions that emphasize exact filename matching requirement."
```

---

### Task 8: Final verification

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS (fix any issues if needed)

- [ ] **Step 3: Run all agents tests**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS

- [ ] **Step 4: Run app tests**

Run: `pnpm --filter website test`
Expected: PASS

- [ ] **Step 5: Run build**

Run: `pnpm build`
Expected: PASS

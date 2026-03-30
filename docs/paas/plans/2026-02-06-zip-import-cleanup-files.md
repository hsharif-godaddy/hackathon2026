---
status: not-implemented
---

# File Cleanup: Clean Up Suspicious Files Instead of Reject

**Goal:** Instead of rejecting uploads/pulls containing suspicious/junk files, clean them up automatically and notify users via warnings. Applies to both zip import AND git pull.

**Architecture:** Shared `CodeSyncFileCleanupService` handles pattern matching and deletion. Both `ProjectImportService` (zip) and `GitOpsService` (git pull) call a single method that deletes all configured patterns directly. DRY principle - cleanup logic written once, used everywhere.

**Tech Stack:** TypeScript, yauzl (zip inspection), Express, dev-supervisor exec

---

## Overview

### Current Behavior

- Zip import: `ZipSecurityService.isSuspiciousFile()` rejects uploads containing `.DS_Store`, `.env`, etc.
- Git pull: NO file validation - all files come through unchecked

### New Behavior

- Shared `CodeSyncFileCleanupService` handles all cleanup logic (DRY)
- Categorize files as "cleanable" (auto-remove) vs "dangerous" (still reject)
- **Zip import: Track cleanable files during validation, delete patterns BEFORE copy from extracted directory**
  - This ensures cleanable files (`.git/`, `.vscode/`, etc.) never overwrite existing app configs
- Git pull: Delete configured patterns after pull (no scanning needed)
- Zip import: Return `cleanedFiles` in warnings array, log for audit trail

### Files to Clean (Configurable List)

**Category A: OS Junk**

- `.DS_Store`, `Thumbs.db`, `__MACOSX/`, `desktop.ini`

**Category B: Security-Sensitive**

- `.env*`, `.git/` (entire directory), `*.pem`, `*.key`, `.npmrc`, `.yarnrc`

**Category C: IDE/Editor**

- `.idea/`, `.vscode/`

### DRY Principle

```
┌─────────────────────────────────────────────────────────┐
│             CodeSyncFileCleanupService                  │
│  (agents/src/services/CodeSyncFileCleanupService.ts)    │
├─────────────────────────────────────────────────────────┤
│  • isCleanableFile(fileName)  ← pattern matching (zip)  │
│  • deleteCleanablePatterns(devSupervisor, path)         │
│     └─ single command, deletes all patterns directly    │
│  • createWarnings(cleanedFiles) → ValidationError[]     │
└─────────────────────────────────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
┌───────────────────────┐   ┌───────────────────────┐
│  ProjectImportService │   │     GitOpsService     │
│     (zip import)      │   │     (git pull)        │
└───────────────────────┘   └───────────────────────┘
```

### Key Simplification

**No scanning needed.** Delete configured patterns directly with a single command:

```bash
rm -rf /app/__MACOSX /app/.idea /app/.vscode /app/.git 2>/dev/null; \
find /app \( -name ".DS_Store" -o -name "Thumbs.db" -o -name "desktop.ini" \
  -o -name ".env*" -o -name "*.pem" -o -name "*.key" \
  -o -name ".npmrc" -o -name ".yarnrc" \) -type f -delete 2>/dev/null || true
```

**Security:** All patterns come from config (hardcoded defaults or env vars). No user input in shell commands.

---

## Task 1: Add Cleanable Files Configuration

**Files:**

- Modify: `agents/src/services/features.ts`

**Step 1: Add defaults and update interface**

Add after line 93 (after existing defaults):

```typescript
// Cleanable file patterns defaults
const DEFAULT_CLEANABLE_OS_JUNK = [
  ".DS_Store",
  "Thumbs.db",
  "__MACOSX/",
  "desktop.ini",
];
const DEFAULT_CLEANABLE_SECURITY = [
  ".env",
  ".git/",
  ".pem",
  ".key",
  ".npmrc",
  ".yarnrc",
];
const DEFAULT_CLEANABLE_IDE = [".idea/", ".vscode/"];
```

**Step 2: Update ZipImportLimits interface**

Add to the interface (around line 106):

```typescript
  /** Patterns for files that should be cleaned up instead of rejected */
  cleanablePatterns: {
    osJunk: string[];
    securitySensitive: string[];
    ideConfig: string[];
  };
```

**Step 3: Update getZipImportLimits function**

Add to the return object:

```typescript
    cleanablePatterns: {
      osJunk: (process.env.ZIP_IMPORT_CLEANABLE_OS_JUNK || DEFAULT_CLEANABLE_OS_JUNK.join(','))
        .split(',').map(p => p.trim()).filter(Boolean),
      securitySensitive: (process.env.ZIP_IMPORT_CLEANABLE_SECURITY || DEFAULT_CLEANABLE_SECURITY.join(','))
        .split(',').map(p => p.trim()).filter(Boolean),
      ideConfig: (process.env.ZIP_IMPORT_CLEANABLE_IDE || DEFAULT_CLEANABLE_IDE.join(','))
        .split(',').map(p => p.trim()).filter(Boolean),
    },
```

**Step 4: Verify**

Run: `pnpm --filter @airo/agents typecheck`

**Step 5: Commit** (ask permission first)

```bash
git add agents/src/services/features.ts
git commit -m "feat(file-cleanup): add cleanable file patterns configuration"
```

---

## Task 2: Add FILE_CLEANED ValidationErrorKey

**Files:**

- Modify: `agents/src/types/import.ts`

**Step 1: Add new key to enum**

Add after `ZIP_SUSPICIOUS_FILE`:

```typescript
  /** File was automatically cleaned during import */
  FILE_CLEANED = 'FILE_CLEANED',
```

**Step 2: Verify**

Run: `pnpm --filter @airo/agents typecheck`

**Step 3: Commit** (ask permission first)

```bash
git add agents/src/types/import.ts
git commit -m "feat(file-cleanup): add FILE_CLEANED validation key"
```

---

## Task 3: Simplify CodeSyncFileCleanupService

**Files:**

- Modify: `agents/src/services/CodeSyncFileCleanupService.ts`
- Modify: `agents/src/services/__tests__/CodeSyncFileCleanupService.test.ts`

**Step 1: Replace complex methods with simple `deleteCleanablePatterns`**

Remove:

- `scanDirectory()` - not needed
- `deleteCleanableFiles()` - replaced by simpler method
- `SAFE_FILENAME_PATTERN` - not needed (no user input in commands)

Add new method:

```typescript
/**
 * Delete all cleanable patterns from the container.
 * Uses configured patterns directly - no scanning needed.
 */
async deleteCleanablePatterns(
  devSupervisor: DevSupervisorClient,
  containerPath: string
): Promise<{ success: boolean; error?: string }> {
  const limits = getZipImportLimits();
  const patterns = limits.cleanablePatterns;

  // Build directory removals
  const dirPatterns = [
    ...patterns.osJunk,
    ...patterns.securitySensitive,
    ...patterns.ideConfig,
  ].filter(p => p.endsWith('/'));

  const rmDirs = dirPatterns
    .map(p => `${containerPath}/${p.slice(0, -1)}`)
    .join(' ');

  // Build find patterns for files
  const filePatterns = [
    ...patterns.osJunk,
    ...patterns.securitySensitive,
    ...patterns.ideConfig,
  ].filter(p => !p.endsWith('/'));

  const findArgs = filePatterns
    .map(p => {
      // .env -> ".env*", .pem -> "*.pem", .DS_Store -> ".DS_Store"
      if (p === '.env') return '".env*"';
      if (p.startsWith('.') && !p.includes('.', 1)) return `"*${p}"`;  // .pem -> *.pem
      return `"${p}"`;
    })
    .map(p => `-name ${p}`)
    .join(' -o ');

  // Single command: rm dirs + find/delete files
  const command = `rm -rf ${rmDirs} 2>/dev/null; find "${containerPath}" \\( ${findArgs} \\) -type f -delete 2>/dev/null || true`;

  try {
    this.logger.info('code-sync-file-cleanup.delete.start', { containerPath });

    const result = await devSupervisor.exec({ command, timeout: 60 });

    this.logger.info('code-sync-file-cleanup.delete.complete', {
      containerPath,
      success: result.success,
    });

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.logger.error('code-sync-file-cleanup.delete.error', {
      containerPath,
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  }
}
```

**Step 2: Fix overly broad pattern matching in `matchesPattern`**

Change line 66 from:

```typescript
if (baseName === lowerPattern || baseName.startsWith(lowerPattern + '.') || baseName.startsWith(lowerPattern)) {
```

To:

```typescript
if (baseName === lowerPattern || baseName.startsWith(lowerPattern + '.')) {
```

This prevents `.env` from matching `.environment`.

**Step 3: Update tests**

Remove tests for deleted methods, add test for `deleteCleanablePatterns`.

**Step 4: Verify**

Run: `pnpm --filter @airo/agents typecheck`

**Step 5: Commit**

```bash
git add agents/src/services/CodeSyncFileCleanupService.ts agents/src/services/__tests__/CodeSyncFileCleanupService.test.ts
git commit -m "refactor(file-cleanup): simplify to single-command pattern deletion"
```

---

## Task 4: Update ZipSecurityService to Use FileCleanupService

**Files:**

- Modify: `agents/src/services/ZipSecurityService.ts`

**Step 1: Import FileCleanupService**

Add import at top:

```typescript
import { codeSyncFileCleanupService } from "./CodeSyncFileCleanupService.js";
```

**Step 2: Update isSuspiciousFile method**

Replace the existing `isSuspiciousFile` method (around line 420):

```typescript
  /**
   * Check for suspicious file patterns
   * Now delegates to FileCleanupService - cleanable files are no longer suspicious
   */
  private isSuspiciousFile(fileName: string): boolean {
    // Cleanable files are handled separately, not rejected
    if (codeSyncFileCleanupService.isCleanableFile(fileName)) {
      return false;
    }
    // No other suspicious patterns currently - kept for future extension
    return false;
  }
```

**Step 3: Track cleanable files in inspectZipStructure**

In the `inspectZipStructure` method, add tracking variable after line 149:

```typescript
const cleanableFiles: string[] = [];
```

Replace the suspicious file check (around line 204-211) with:

```typescript
// Check 5: Track cleanable files (no longer causes rejection)
if (codeSyncFileCleanupService.isCleanableFile(entry.fileName)) {
  cleanableFiles.push(entry.fileName);
}
```

Update the 'end' event handler to include cleanableFiles:

```typescript
zipfile.on("end", () => {
  const stats: ZipValidationStats = {
    fileCount,
    totalUncompressedSize: totalUncompressed,
    compressedSize,
    compressionRatio:
      compressedSize > 0 ? totalUncompressed / compressedSize : 0,
    ...(largestFile && { largestFile }),
  };

  resolve({
    valid: errors.length === 0,
    errors,
    stats,
    cleanableFiles: cleanableFiles.length > 0 ? cleanableFiles : undefined,
  });
});
```

**Step 4: Update ZipValidationResult type**

In `agents/src/types/import.ts`, add to ZipValidationResult interface:

```typescript
  /** Files that will be cleaned during import */
  cleanableFiles?: string[];
```

**Step 5: Verify**

Run: `pnpm --filter @airo/agents typecheck`

**Step 6: Commit** (ask permission first)

```bash
git add agents/src/services/ZipSecurityService.ts agents/src/types/import.ts
git commit -m "feat(zip-import): use FileCleanupService for cleanable file detection"
```

---

## Task 5: Update ProjectImportService to Use Simplified Cleanup

**Files:**

- Modify: `agents/src/services/ProjectImportService.ts`

**Step 1: Simplify cleanup call**

Replace the current cleanup logic (around line 299-315) with:

```typescript
// Clean up unwanted files (deletes all configured patterns)
await codeSyncFileCleanupService.deleteCleanablePatterns(devSupervisor, "/app");

// Store warnings for files detected during zip validation
if (cleanableFiles.length > 0) {
  const warnings = codeSyncFileCleanupService.createWarnings(cleanableFiles);
  await this.importJobRepo.update(jobId, {
    validationErrors: [...(validation.warnings || []), ...warnings],
  });
}
```

**Step 2: Verify**

Run: `pnpm --filter @airo/agents typecheck`

**Step 3: Commit**

```bash
git add agents/src/services/ProjectImportService.ts
git commit -m "refactor(zip-import): use simplified deleteCleanablePatterns"
```

---

## Task 6: Update GitOpsService to Use Simplified Cleanup

**Files:**

- Modify: `agents/src/services/GitOpsService.ts`

**Step 1: Replace scan+delete with single call**

Replace current cleanup logic (around lines 432-459) with:

```typescript
// Clean up junk/security-sensitive files after pull (no scanning needed)
await codeSyncFileCleanupService.deleteCleanablePatterns(devSupervisor, "/app");
logger.info("git-ops.pull.cleanup.complete", { appId, jobId });
```

**Note:** For git pull, we don't track which specific files were cleaned (unlike zip import where we know from validation). This is acceptable since:

- The patterns are the same for both
- Git pull doesn't need to return warnings in status API (files weren't in the original upload)

**Step 2: Verify**

Run: `pnpm --filter @airo/agents typecheck`

**Step 3: Commit**

```bash
git add agents/src/services/GitOpsService.ts
git commit -m "refactor(git-pull): use simplified deleteCleanablePatterns"
```

---

## Task 7: Update Git Status API to Return Warnings

**Files:**

- Modify: `agents/src/server/routes/git-remote.ts`

**Step 1: Update pull status response**

Find the pull status endpoint and ensure it returns warnings from the job's validationErrors field (similar to zip-import status).

The job already stores `validationErrors`. Ensure the status response includes them:

```typescript
// In the status response, add:
warnings: job.status === ImportJobStatus.COMPLETED ? job.validationErrors : undefined,
```

**Step 2: Verify**

Run: `pnpm --filter @airo/agents typecheck`

**Step 3: Commit** (ask permission first)

```bash
git add agents/src/server/routes/git-remote.ts
git commit -m "feat(git-pull): return cleaned file warnings in status API"
```

---

## Task 8: Run Full Test Suite

**Step 1: Type check**

Run: `pnpm --filter @airo/agents typecheck`

**Step 2: Unit tests**

Run: `pnpm --filter @airo/agents test:unit`

**Step 3: Lint**

Run: `pnpm --filter @airo/agents lint`

**Step 4: Final commit** (ask permission first)

```bash
git add -A
git commit -m "feat(file-cleanup): complete implementation for zip and git pull

- Shared FileCleanupService handles all cleanup logic (DRY)
- Zip import: tracks cleanable files, deletes after copy
- Git pull: scans directory, deletes before restart
- Both return warnings in status API
- Configurable patterns via environment variables"
```

---

## Summary

| Task | Description                         | Files                         |
| ---- | ----------------------------------- | ----------------------------- |
| 1    | Add cleanable patterns config       | features.ts                   |
| 2    | Add FILE_CLEANED key                | import.ts                     |
| 3    | Simplify CodeSyncFileCleanupService | CodeSyncFileCleanupService.ts |
| 4    | Update ZipSecurityService           | ZipSecurityService.ts         |
| 5    | Update ProjectImportService         | ProjectImportService.ts       |
| 6    | Update GitOpsService                | GitOpsService.ts              |
| 7    | Update git status API               | git-remote.ts                 |
| 8    | Run full test suite                 | -                             |

**Key Simplifications:**

- Removed `scanDirectory()` - not needed
- Replaced `deleteCleanableFiles(files)` with `deleteCleanablePatterns()` - single command, no input
- Fixed overly broad pattern matching (`.env` no longer matches `.environment`)

## Verification

1. **Zip Import Test:**

   - Upload a zip containing `.DS_Store`, `.env`, `.idea/` files
   - Should complete successfully
   - Status API should return warnings listing cleaned files

2. **Git Pull Test:**

   - Pull from a repo containing `.DS_Store`, `.env` files
   - Should complete successfully
   - Files should be cleaned (no warnings needed for git pull)

3. **Dangerous Files Still Rejected:**

   - Upload zip with `.exe` file
   - Should fail validation (dangerous extension)

4. **Pattern Matching:**
   - `.environment` file should NOT be cleaned
   - `.env.local` file SHOULD be cleaned

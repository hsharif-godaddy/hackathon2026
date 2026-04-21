# Persistent File Uploads: Private-First Storage

**Date:** 2026-04-09
**Status:** Draft

## Problem

Chat file uploads rely on the AI agent to copy files from a temporary directory to the project workspace. This is unreliable:

1. **Agent compliance is non-deterministic** - the agent might skip the copy, use the wrong path, or reference temporary upload URLs directly in generated code
2. **Heuristic filename matching** - `resolveSourceFile()` uses name-similarity scoring to guess which upload maps to which target path, which can pick the wrong file
3. **24-hour expiry** - files are deleted after 24h regardless of whether the agent acted on them
4. **Dual intent ambiguity** - uploads serve two purposes that can't be distinguished at upload time:
   - **Context**: screenshots, reference images ("make it look like this")
   - **Assets**: logos, fonts, images the user wants in their site

## Design

### Core Principle: Persist in Private, Promote via Existing Tools

All chat uploads are stored in persistent private storage immediately. Files are never deleted automatically (except on app deletion). When a file needs to be used as a project asset, the agent promotes it to public storage using the existing `str_replace_based_edit_tool` `create` command - but with deterministic exact-match resolution instead of the current heuristic scoring. No new tools are introduced.

### Storage Flow

```
User uploads file via chat
    |
    v
POST /files/upload
    |
    v
Validate (type, size, SVG sanitize)
    |
    v
Write to {persistentPrivateDir}/uploads/{appId}/{uploadId}/
    {appId}_{timestamp}_{fileId}.{ext}
    metadata.json (no expiresAt field)
    |
    v
Return file info + signed URL for preview
```

### Directory Layout

The existing nested directory structure is preserved (`{appId}/{uploadId}/`) so that `FileUploadService` internals (listing, lookup by uploadId, per-batch metadata) remain unchanged. Only the root directory moves.

```
# Production container paths (SHARED_STORAGE_DIR=/shared-storage)
/private/uploads/                              # Chat uploads (Ceph: assetsPrivatePath)
    {appId}/
        upload_{uploadId}/
            {appId}_{timestamp}_{fileId}.ext
            metadata.json                      # Same schema minus expiresAt

/shared-storage/public/assets/                 # Public assets (Ceph: assetsPublicPath)
    media/                                     # Media slot uploads (existing)
    uploads/                                   # Promoted chat uploads + AI-generated media

# Host (local dev) paths (no SHARED_STORAGE_DIR)
{appId}/../assets/private/uploads/             # Chat uploads
    {appId}/
        upload_{uploadId}/
            ...
{appId}/../assets/public/                      # Public assets
```

### FileUploadService Root Directory Change

`FileUploadService` is a module-level singleton (`FileUploadService.ts:701`) whose constructor takes an optional `baseDir`, defaulting to `getAgentConfig.uploadDir()` which returns `process.env.UPLOAD_DIR || 'data/uploads'`.

**Current production value**: `UPLOAD_DIR=/local/uploads` (set in `agent.libsonnet:122`). This is ephemeral container-local storage - uploads don't survive container restarts. This is why the 24h expiry exists: files were already ephemeral in practice.

**Changes required in two repos:**

1. **mhp-core** (`agent.libsonnet`): Change `UPLOAD_DIR` from `/local/uploads` to `/private/uploads`. This puts uploads on the Ceph-backed persistent `/private` mount (`assetsPrivatePath`).

2. **airo-app-builder** (`features.ts`): Update `getAgentConfig.uploadDir()` default from `'data/uploads'` to `getPersistentPrivateDir(appPath) + '/uploads'`. This only affects local dev (production always has `UPLOAD_DIR` set explicitly).

The singleton pattern and constructor are unchanged. The `UPLOAD_DIR` env var continues to be the source of truth - the `features.ts` default is just the local dev fallback.

### Case 1: Context-Only Use

When uploads are used as conversation context (e.g., screenshots):

1. Upload lands in private storage (new behavior)
2. `readAgentUploadAsBase64()` (used by both `ContextFormatter` and `SelectedAssetsContextRenderer`) reads from private storage and base64-encodes into the message
3. Agent sees the image inline in conversation - no file path needed
4. File stays in private storage indefinitely (small, bounded per app)

**`readAgentUploadAsBase64()`** (`ContextFormatter.ts:154-228`): Parses URLs matching `/files/uploads/{appId}/{filename}`, then uses `fileUploadService.listUploadedFiles()` + `fileUploadService.getFilePath()` to locate files. Since we preserve the nested directory structure, these methods continue to work - only the root `uploadsDir` changes. No code change needed in this function.

**`readUploadedFileContent()`** (`ContextFormatter.ts:34-123`): This function independently resolves upload paths using `features.uploadDir` instead of `FileUploadService`. It must be refactored to use `fileUploadService` methods for consistency. Currently it manually constructs paths from `features.uploadDir` and iterates subdirectories - duplicating logic that `FileUploadService` already provides. Refactoring it to use `fileUploadService.listUploadedFiles()` and `fileUploadService.getFilePath()` ensures it automatically follows the new root directory.

### Case 2: Project Asset Use

The agent continues to use `str_replace_based_edit_tool` with `create` command and empty `file_text` to place uploaded files into the project. The mechanism is the same; only the resolution logic changes.

**Before (heuristic):**

1. Agent calls `create` with `path: 'public/assets/logo.png', file_text: ''`
2. `resolveSourceFile()` lists all uploads, scores by name similarity, picks best guess
3. If multiple uploads with similar names exist, scoring can pick the wrong one
4. Race conditions with concurrent `create` calls require `upload-resolution-tracking`

**After (deterministic):**

1. Agent calls `create` with `path: 'public/assets/logo.png', file_text: ''`
2. Resolution does exact match on `originalName` or `filename` field
3. If no exact match, fails with a clear error listing available upload filenames so the agent can retry
4. No scoring, no extension fallback, no race-condition tracking needed

**Trade-off**: This is intentionally fail-safe over fail-silent. If the agent uses a different filename than the original (e.g., uploads `hero-image.jpg`, agent creates `hero.jpg`), resolution fails with an actionable error instead of silently picking the wrong file. The agent can retry with the correct name.

**Two `resolveSourceFile()` implementations**: Both the standalone export at `file-edit.ts:1687` (used by `text-editor.ts`) and the private class method at `file-edit.ts:712` (used by the class-based `FileEditTool`) contain identical heuristic logic. Both must be simplified to exact-match.

The context injected into the conversation already includes the exact upload filenames. The agent prompt simplifies from the 30-line MANDATORY WORKFLOW to:

```
UPLOADED FILES - How to use:
- To use an uploaded file in the project, create the file at the desired path with empty content:
  file_edit({ path: "public/assets/logo.png", mode: "create", content: "" })
- The target filename MUST exactly match the uploaded file's original name for auto-resolution.
- If resolution fails, the error will list available upload filenames.
- NEVER reference /files/uploads/ URLs in code - they are not web-accessible
```

### What Gets Removed

1. **Heuristic matching in both `resolveSourceFile()` implementations** (`file-edit.ts:712` class method and `file-edit.ts:1687` standalone export) - name-similarity scoring and extension fallback. Functions stay but are simplified to exact match only.
2. **`upload-resolution-tracking.ts`** and its test file (`__tests__/upload-resolution-tracking.test.ts`) - race-condition tracking no longer needed
3. **`deleteExpiredUploads()`** in `FileUploadService.ts:590-656` - no more expiry
4. **`FileCleanupService`** (`services/FileCleanupService.ts`) - hourly interval removed. Note: `cleanupAppUploads()` (app deletion cleanup) must be preserved - callers should use `fileUploadService.cleanupAppUploads()` directly.
5. **`UPLOAD_EXPIRY_HOURS`** constant
6. **`expiresAt`** field from upload `MetadataSchema` (Zod), upload metadata, and `UploadResult` interface
7. **`clearExtensionResolved()`** calls in both `processUpload()` and `cleanupAppUploads()` (line 692)
8. **`pickAndMarkExtensionResolved()`** and `scoreNameSimilarity()` helper functions

### What Changes

| Component                                     | Before                                                           | After                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `UPLOAD_DIR` in `agent.libsonnet` (mhp-core)  | `/local/uploads` (ephemeral)                                     | `/private/uploads` (persistent Ceph mount)                                                        |
| `getAgentConfig.uploadDir()` in `features.ts` | Returns `UPLOAD_DIR \|\| 'data/uploads'`                         | Returns `UPLOAD_DIR \|\| getPersistentPrivateDir(appPath) + '/uploads'` (local dev fallback only) |
| `FileUploadService` constructor               | Unchanged                                                        | Unchanged (gets new default from features)                                                        |
| `FileUploadService.processUpload()`           | Writes metadata with `expiresAt`                                 | Writes metadata without `expiresAt`                                                               |
| `FileUploadService.cleanupAppUploads()`       | Cleans `data/uploads/{appId}/`, calls `clearExtensionResolved()` | Cleans new root dir, no `clearExtensionResolved()` call                                           |
| `MetadataSchema` (Zod)                        | `expiresAt: z.string()` (required)                               | `expiresAt: z.string().optional()`                                                                |
| `UploadResult` interface                      | `expiresAt: string` (required)                                   | `expiresAt?: string` (optional)                                                                   |
| Client-side `UploadResult` type               | `expiresAt: string`                                              | `expiresAt?: string`                                                                              |
| `resolveSourceFile()` (both implementations)  | Heuristic: exact match -> extension + scoring                    | Exact match only. Error lists available filenames.                                                |
| `readUploadedFileContent()`                   | Independently resolves paths via `features.uploadDir`            | Refactored to use `fileUploadService` methods                                                     |
| `readAgentUploadAsBase64()`                   | Uses `fileUploadService` methods                                 | No change needed (transparent)                                                                    |
| `SelectedAssetsContextRenderer`               | 30-line MANDATORY WORKFLOW prompt                                | Short instruction (see above)                                                                     |
| Signed URL serving route (`files.ts`)         | Scans via `fileUploadService`                                    | No change needed (transparent)                                                                    |
| `media.ts` apply-upload route                 | Uses `fileUploadService` methods                                 | No change needed (transparent)                                                                    |
| `FileCleanupService` startup in `app.ts`      | Starts hourly cleanup interval                                   | Removed. Verify no callers of `fileCleanupService.cleanupAppUploads()` exist before removing.     |

### New Components

None. All changes are to existing components.

### Backward Compatibility

- **`expiresAt` field**: Made optional on `MetadataSchema` (Zod), `UploadResult` interface (both agents and client types). Existing uploads with `expiresAt` in metadata continue to parse. New uploads omit it.
- **Existing uploads in `data/uploads/`**: On deployment, files in the old location become inaccessible. No migration needed - these files are all < 24h old (the current expiry) and were already treated as temporary. They'll be orphaned but harmless; the old `data/uploads/` directory can be ignored or cleaned up manually.
- **`apply-upload` media route**: Continues to work transparently since it uses `FileUploadService` methods.
- **No client-side upload flow changes**: Upload API request/response shape unchanged (aside from optional `expiresAt`).
- **`resolveSourceFile()` callers**: Function signature unchanged. Behavior change is internal: heuristic -> exact match. Returns `null` on no match (same as before). The error message (logged, not returned to caller) now includes available filenames for debugging.

### Storage Bounds

Private uploads are bounded by:

- Per-file: 10MB max (existing limit)
- Per-upload: 5 files max (existing limit)
- Per-app: Practical limit is conversation usage patterns. A heavy user might accumulate ~100MB of uploads over an app's lifetime.
- **App deletion**: `fileUploadService.cleanupAppUploads()` handles cleanup on app deletion. With the new root directory, this continues to work (same logic, different root).

No automatic expiry cleanup is proposed. If storage becomes a concern:

- Log a warning when per-app upload storage exceeds a threshold (e.g., 200MB)
- Add a per-app quota later if needed

### Production vs Local Dev Path Resolution

Production and local dev have different filesystem layouts. All path differences are handled by existing abstractions (`UPLOAD_DIR` env var, `getPersistentPrivateDir()`, `getPersistentPublicDir()`, `SHARED_STORAGE_DIR`).

| Concern                   | Production (container)                                                                            | Local Dev (host)                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Upload root**           | `/private/uploads/` (via `UPLOAD_DIR=/private/uploads` in `agent.libsonnet`)                      | `{appPath}/../assets/private/uploads/` (via `getPersistentPrivateDir(appPath) + '/uploads'` default in `features.ts`) |
| **Upload root backing**   | Ceph persistent storage (`assetsPrivatePath` bind mount)                                          | Local filesystem                                                                                                      |
| **Public assets dir**     | `/shared-storage/public/assets/` (via `SHARED_STORAGE_DIR=/shared-storage`)                       | `{appPath}/../assets/public/` (no `SHARED_STORAGE_DIR`)                                                               |
| **Public assets backing** | Ceph persistent storage (`assetsPublicPath` bind mount)                                           | Local filesystem                                                                                                      |
| **Private mount**         | `/private` (Ceph bind mount, read-write)                                                          | `{appPath}/../assets/private/`                                                                                        |
| **Cross-mount copies**    | Yes - `/private` and `/shared-storage` are separate Ceph mounts. File copy (not rename) required. | No - both dirs are on the same local filesystem                                                                       |

**Key env vars set in production (`agent.libsonnet`):**

- `UPLOAD_DIR=/private/uploads` (changed from `/local/uploads`)
- `SHARED_STORAGE_DIR=/shared-storage`

**Local dev has neither set.** Path resolution falls back to `getPersistentPrivateDir(appPath)` and `getPersistentPublicDir(appPath)` which compute paths relative to `appPath`.

## Decisions

1. **No new tool.** The existing `str_replace_based_edit_tool` `create` command handles file promotion. Resolution is simplified from heuristic to exact-match.

2. **Exact match is fail-safe.** If the agent uses a non-matching filename, resolution fails with an error listing available uploads. This is preferable to silently picking the wrong file via heuristic scoring.

3. **Two-repo change for storage root.** Production: `UPLOAD_DIR` changes from `/local/uploads` to `/private/uploads` in mhp-core `agent.libsonnet`. Local dev: `features.ts` default changes to use `getPersistentPrivateDir()`. The `FileUploadService` singleton and constructor are unchanged.

4. **No migration.** Existing uploads are all < 24h old (current expiry). Orphaned files in `data/uploads/` are harmless.

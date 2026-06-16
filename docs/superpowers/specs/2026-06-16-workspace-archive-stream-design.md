# Workspace archive streaming — design

**Date:** 2026-06-16
**Author:** Dan Everton
**Status:** Approved (design); implementation pending
**Tracking:** new substory under AIROBUILD-1807 (Base Agent Updates Phase 1 — bulk WorkspaceClient primitive)

## Problem

App-code download (`GET /apps/:id/zip`, `agents/src/server/routes/download.ts`) produces
bundles that are **not true to the actual app**: any file larger than 10MB is silently
dropped.

The route walks the workspace via `WorkspaceFiles.tree()` and then fetches each file with
`WorkspaceFiles.download()` → dev-supervisor `GET /workspace/files/download`. That handler
stats the file and rejects anything over `wsFilesMaxReadBytes` (10MB) with
`413 file_too_large` (`dev-supervisor/cmd/dev-supervisor/api_workspace_files.go:1246`). The
constant's own comment reads `// 10MB max file read (view)` — the streaming `download`
endpoint inherited a cap designed for the agent's *view* tool, even though it streams via
`io.Copy` and needs no cap for memory reasons on the Go side.

Post-#4923 the 413 is caught, logged as `route.apps.zip.file.failed`, and the file is
skipped — so the customer gets a structurally valid zip that is **missing files**. The
10MB cap is confirmed in production as the failing error (`li72ic2zdy`, `e0tbxfur4q`).

A second truncation axis exists: `tree()` caps each directory at `wsFilesDefaultMaxEntries`
(1000), logging `route.apps.zip.tree.truncated` — an app with >1000 files in one allowlisted
directory also loses files.

A third, structural concern: the whole agent-side pipeline buffers each file fully into
memory (`getRaw` → `Uint8Array` → `archive.append(buffer)`), bounded only by
`DOWNLOAD_CONCURRENCY = 8`. Naively raising the 10MB cap would move an OOM risk onto the
agent's constrained heap (`--max-old-space-size=384`).

## Goal

Produce app bundles that faithfully reflect the app's source on disk, with no artificial
per-file size cap and no per-directory entry cap, without risking the agent's memory budget.

## Approach (chosen)

Move archive assembly into **dev-supervisor**, which is co-located with the workspace
filesystem. Add a generic, product-agnostic **streaming-zip primitive**; the agent supplies
the allowlist and proxies the resulting stream straight to the client.

Rejected alternative — *patch in place* (give `download` its own cap + stream each file into
the archiver on the agent side + paginate the tree walk): removes the 10MB symptom but keeps
the fragile N-round-trip shape (the per-file failure surface #4923 had to patch), still streams
every byte twice (dev-supervisor → agent → client), and leaves the 1000-entry cap as a
separate fix.

This fits AIROBUILD-1807: `WorkspaceClient` is the agent's sole interface to the
preview/publish containers; the download route is already migrated to it. Doing the bundle as
`tree()` + N× `download()` is the granular API used for a bulk job it is bad at. A "zip the
workspace" capability is the natural bulk primitive on that same surface, and aligns with the
filesystem-abstraction principle (the workspace owns the FS; the agent stops even reading the
bytes — it just proxies the stream).

## API contract (dev-supervisor)

New endpoint under the existing `wsFilesRouter`:

```
POST /workspace/files/archive
{
  "dirs":   ["src", "public", "format-overrides"],   // recurse; skip if missing
  "files":  ["package.json", "pnpm-lock.yaml", ...],  // explicit; skip if missing
  "prefix": "<baseName>"                               // top-level folder inside the zip
}
→ 200 application/zip   (streamed; chunked transfer, no Content-Length)
```

- Every `dirs`/`files` entry is validated through `validation.ValidateFilePath` against
  `fsBaseDir()` — the same path-traversal guard as every other workspace-files handler.
- dev-supervisor walks `dirs` with `filepath.WalkDir`, appends the existing `files`, and writes
  a `archive/zip` stream **directly to the `http.ResponseWriter`**: O(1) memory on the Go side,
  **no `wsFilesMaxReadBytes` cap**. Entry names are `prefix/<relpath>`.
- The request goes under `wsFilesRouter`, whose 10MB **request-body** middleware is fine — the
  request body is a tiny JSON allowlist; only the *response* is large.
- The request shape is generic. Only the download route is wired now (see Scope), but the
  endpoint is reusable (e.g. publish/export) without change.

## Agent side

- New `WorkspaceClient.files.archive(opts)` returns the raw response **stream** (a new
  stream-returning client call), not a buffered `Uint8Array`.
- `download.ts` collapses: no `tree()` walk, no `withConcurrency`, no per-file `download()`
  loop, no `archiver` dependency. It builds `{ dirs, files, prefix: baseName }` from the
  existing allowlist (`@airo/shared/app-structure` via `app-download.ts`), calls `archive()`,
  and pipes the stream to `res`. Naming / `baseName` policy stays in the agent.
- This eliminates the 1000-entry `tree()` cap axis for free — dev-supervisor's own walk is not
  bounded by `wsFilesDefaultMaxEntries`.

## Error handling

The skip-don't-corrupt policy established by #4923 moves server-side:

- **Per-file read error mid-walk:** dev-supervisor logs `workspace.files.archive.file.failed`
  and skips that entry, then still `Close()`s the zip writer so the central directory is
  written. One process now owns the whole archive instead of a fragile N-round-trip pipeline,
  so this failure mode is far rarer than an HTTP round-trip failing.
- **Failure before the first byte** (validation error, base dir missing, empty result): normal
  JSON error response → agent returns a clean 4xx/5xx.
- **Failure after streaming has started:** the header is already sent and cannot be un-sent;
  dev-supervisor aborts the connection, and the agent propagates via `res.destroy()` — a
  truncated transfer, never a fake-200 corrupt zip. Identical semantics to today's outer catch.
- **Total failure floor:** preserve the existing "0 files succeeded is a failure" guard — if the
  walk yielded entries but all failed to read, the response must not present as success.

## Guards

- **No per-file cap** — that is the point of the change.
- **Generous total-bytes + entry-count backstop** (a new configurable constant), purely to
  bound runaway/zip-bomb archives. Logged when hit, not a normal-path limit.
- Emit `workspace.files.archive.success { entryCount, failedCount, bytes }` mirroring
  `route.apps.zip.success`.

## Testing

- **dev-supervisor:** socket-only black-box integration test (per the strangler-harness rule —
  no `suite.server.*` access, works in `inproc`/`subproc`/`strangler`): valid zip with the
  expected entries; skip-on-failure still finalizes to a structurally valid zip.
- **agent:** repurpose `download.archive.test.ts` (added by #4923) to assert the route proxies a
  real streamed zip and sets `Content-Type`/`Content-Disposition`; the per-file-skip assertions
  move to the dev-supervisor suite.
- **TS client contract:** update `DevSupervisorClient` / `http-files` adapter and test the new
  `archive()` stream call end-to-end against the real binary.

## Rollout / compatibility

Agent + preview deploy in the **same Nomad job**, so they are always version-matched — no
cross-version skew, and no fallback to the old `tree()` + `download()` path is required. The
old per-file path and the `archiver` usage in `download.ts` are removed outright.

## Scope

- **In scope now:** the generic dev-supervisor `archive` endpoint, the `WorkspaceClient.archive`
  stream method, and rewiring `download.ts` to use it. Build the endpoint generically so
  publish/export can reuse it later, but wire only the download route.
- **Out of scope:** publish/export adoption (deferred — YAGNI); the unrelated `view`
  directory-rejection-gap parity fix is noted separately and may be folded in opportunistically
  while in `api_workspace_files.go`, at the author's discretion.

## Related

- PR #4923 — skip-don't-corrupt resilience fix (the symptom patch this supersedes structurally).
- `view` vs `download` handler analysis; `view` lacks the explicit `IsDir` rejection that
  `download` has — tracked as a separate parity fix.
- AIROBUILD-1807 (WorkspaceClient migration), `project_filesystem_abstraction`.

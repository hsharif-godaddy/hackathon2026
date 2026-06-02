# Workspace API Migration — Follow-up Plan

**Context:** PR #4345 (`refactor(agents): finish Workspace API migration for fs/exec stragglers`) closes the 6 known stragglers from #4287 and tightens AppContextManager soft-fallback behavior. While verifying that PR, we found additional gaps that violate the same principle: **the agent process must access the preview filesystem only via the Workspace API / dev-supervisor — never directly.**

This plan groups those gaps into one keystone stack and three independent series.

**Principles (recap):**
- Reads/writes against preview FS go through `workspace.files.{view,tree,download,upload,write,edit,...}`.
- Exec against preview goes through `workspace.tasks.runCommand{,Sync}` with `workingDir: '/app'`.
- Errors only swallowed when `isDevSupervisorNotFound(err)` is true; everything else propagates so supervisor outages aren't silently degraded.

---

## Stack A — Eliminate `LocalFileSystemOperations` ✅ PR #4375

**Status:** all three commits landed on `deverton/workspace-stack-a`.

The `FileSystemOperations` abstraction was added in #2460 to let tools swap between local and dev-supervisor backends, but the supervisor-backed adapter never landed. Today every consumer of the abstraction reads the host filesystem. Modern tools (after #3845/#4287) skip the abstraction entirely and call `workspace.files.*` directly. This stack collapses the codebase onto that pattern and deletes the abstraction.

### A1. Migrate `DirectoryListingTool` to `workspace.files.tree`

- **Why:** `DirectoryListingTool` reads via `fs.readdir`/`fs.stat`. Three call sites pass `app.path` (host) to it.
- **Change:** Rewrite `agents/src/tools/directory-listing.ts` to take `WorkspaceFiles` (or `WorkspaceClient`) instead of `FileSystemOperations` and call `files.tree({path, recursive, maxDepth, includeGlobs, excludeGlobs})`. The dev-supervisor `/workspace/files/tree` response already returns `path/kind/size/modifiedAt` — data shape matches existing `DirectoryEntry`.
- **Migrate callers in this same PR:**
  - `agents/src/tools/ai-lib-tools/directory-listing.ts` — bind via `createForWorkspace(appId, 'preview')` per call, drop the module-level singleton.
  - `agents/src/server/routes/apps.ts:45,560` (`GET /apps/:id/files`).
  - `agents/src/services/AppContextManager.ts:45,207` — for `checkDependenciesInstalled`, replace the directory-walk-and-grep-mtime trick with two direct `workspace.files.view` calls (or one `tree` filtered to `package.json`/`package-lock.json` reading their `modifiedAt` fields).
- **Test plan:** existing `directory-listing` tests + new tests against a strict workspace.files mock (Map-keyed like the `download.test.ts` mock from PR #4345 review). Verify the LLM tool still returns the same tree shape.

### A2. Remove `LocalFileSystemOperations` defaults from `file-edit-utils` and `file-types`

- **Why:** These are the last `defaultLocalFs` users.
  - `agents/src/tools/file-edit-utils.ts:23,88` — `isFileImmutable`, `resolveFilePath` default-arg `defaultLocalFs`.
  - `agents/src/utils/file-types.ts:128` — `isBinaryFile` default-arg `defaultLocalFs`.
- **Change:** Make `fsOps` parameter required, audit all callers to pass a workspace-backed FS or rewrite them to use `workspace.files.view` directly (most need only "read first N bytes" and "stat" — both available via `view` with `limit`).
- **Test plan:** unit tests for both helpers (already exist) — update mocks.

### A3. Delete the `FileSystemOperations` abstraction

- **Why:** No remaining consumers after A1+A2.
- **Change:** Delete `agents/src/filesystem/{local.ts,types.ts,index.ts}` and the test. Remove all `import` references.
- **Test plan:** typecheck + lint pass; no test changes needed.

---

## Series B — Direct preview-fs reads (independent, can land in any order)

Each item is a small focused PR. None depend on each other. All can land before, during, or after Stack A — but A1 makes A1's call sites trivial follow-ups (e.g., the `workspace.files.tree` in `icons-validator` can reuse the same call shape).

### B1. `video-generation-tool.ts:296` — `fs.access` on preview

- **Why:** `await access(path.join(this.appPath, 'public/assets/images', filename))` reads host FS.
- **Change:** Replace with `workspace.files.view({path: ..., limit: 1})` inside try/catch — `isDevSupervisorNotFound` ⇒ "file missing" branch, anything else propagates.
- **Test plan:** add a test that the existence check uses workspace.files.

### B2. `context-manager.ts:145,170` — `existsSync` for kit-meta + upload-classification

- **Why:** Two checks for `<app.path>/docs/ui-kit/kit-meta.json` and `<app.path>/docs/.upload-classification.json` use host `existsSync`.
- **Change:** Replace with `workspace.files.view` + `isDevSupervisorNotFound` guard. Both call sites are independent.
- **Test plan:** existing context-manager tests; add one assertion per site that the check uses workspace.files.

### B3. `load-ui-kit.ts` — direct fs reads against `app.path/docs/ui-kit`

- **Why:** `existsSync` / `readdirSync` / `readFileSync` / `statSync` all against host paths under `app.path/docs/ui-kit`.
- **Change:** `workspace.files.tree({path: 'docs/ui-kit', recursive: true})` to enumerate, then `workspace.files.view` per file. Bound by `wsFilesDefaultMaxEntries` (1000) — typical UI kits well under.
- **Test plan:** rewrite existing tests with strict Map-keyed workspace mock.

### B4. `icons-validator.ts` — recursive fs scan for icon validation

- **Why:** Walks the entire app source recursively via `fs.readdir`/`fs.access`/`fs.readFile` to find `.tsx`/`.ts`/`.jsx`/`.js` files using lucide icons.
- **Change:** `workspace.files.tree({recursive: true, includeGlobs: ['**/*.{ts,tsx,js,jsx}'], excludeGlobs: ['node_modules/**', 'dist/**']})` then per-file `view`. Concurrency-cap downloads (8 like `download.ts`).
- **Test plan:** existing tests need new mocks; assert the icon scan still flags the same set of violations.

---

## Series C — Soft-fallback hardening (independent)

Pattern: code wraps a workspace call in try/catch and returns `null`/`[]`/empty for **any** error. Should: only swallow `isDevSupervisorNotFound`; propagate everything else. Same shape as the gitStatus/getPackageInfo/getSecretsInfo fixes in PR #4345.

### C1. `AppContextManager.getDesignSystemInfo` + `getMediaSlotsInfo`

- **Why:** Both wrap calls to service layers (`appPlanTool`, `mediaManifestService`) that internally hit workspace. Generic catch returns null, hiding outages.
- **Change:** Audit `appPlanTool.execute` and `mediaManifestService.getManifest` — if they already return `{success: false}` for legitimate misses, drop the outer catch. If they throw, narrow to `isDevSupervisorNotFound`.
- **Test plan:** make sure the unit tests still cover the "no design system configured yet" case and add a test for transport propagation.

### C2. `memory-service.ts` `list()` — per-entry read failures swallowed

- **Why:** Lines ~123–126: per-file read failures inside the list loop log a warn and continue. A flaky supervisor produces partial lists with no signal to the caller.
- **Change:** Decide policy — either propagate any non-not-found error (recommended; matches the rest of the principle), or accumulate and rethrow at end with a list of failures. Keep `isDevSupervisorNotFound` as the only swallow case.
- **Test plan:** add a test for partial-failure semantics under your chosen policy.

### C3. `FileUploadContextRenderer` — "uploaded but not found" message hides outages

- **Why:** Two sites (~191, ~261) catch all errors and render `"<file> was uploaded but not found on disk"`. Misleads the user during a supervisor blip.
- **Change:** Narrow to `isDevSupervisorNotFound` for the "not found" rendering; rethrow other errors so the renderer fails the upload context section visibly.
- **Test plan:** rendererr tests for both branches.

### C4. `AppRestartService.readPackageJsonScripts` — hardcoded empty fallback

- **Why:** Catches all errors and returns hardcoded empty scripts. Parse error vs. supervisor outage are conflated.
- **Change:** Distinguish `SyntaxError` (parse failure → log warn, return empty — that's recoverable) from any other error (transport → propagate so the restart cycle fails visibly with a real signal).
- **Test plan:** existing AppRestartService tests; add a transport-failure case.

---

## Series E — dev-supervisor API additions (independent, dev-supervisor PRs)

While migrating in Stack A we hit three rough edges in the `/workspace/files/*` API. Each is a pure addition (no breaking change), can be filed against `dev-supervisor/` separately, and unlocks cleaner downstream callers in Series B.

### E1. `kindFilter: 'file' | 'directory'` on `tree`

- **Why:** `directoriesOnly` mode in `DirectoryListingTool` currently fetches every file then drops them client-side. A `node_modules`-style directory with thousands of entries wastes the entire payload (and risks the 1000-entry truncation cap kicking in before the directories the caller actually wants are reached). Real bandwidth win for the LLM-facing `directory_listing` tool.
- **Change:** Add an optional `kindFilter` field to `wsFilesTreeRequest`. When set, drop non-matching entries before they count against `maxEntries`. Subdirectory descent should still happen regardless (so `kindFilter: 'file'` still recurses into `src/`, `kindFilter: 'directory'` still walks the tree to find nested directories).
- **Caller updates:** drop the post-tree `kind === 'directory'` filter in `DirectoryListingTool.listDirectory` once supported.

### E2. Path-aware globs in `includeGlobs` / `excludeGlobs`

- **Why:** `wsFilesMatchesGlobs` calls Go's `filepath.Match` against the basename only (`e.Name()`). So `excludeGlobs: ['src/legacy/**']` doesn't match anything — you can only exclude *names* like `legacy` at any nesting level. Several callers want to scope by directory path:
  - `download.ts` — currently lists per allowlisted directory in parallel; one path-glob query would do it.
  - `icons-validator.ts` (Series B4) — wants `excludeGlobs: ['node_modules/**', 'dist/**']` to scope the recursive scan.
  - Any future caller that needs "exclude tests under src/legacy/ but keep them under src/new/."
- **Change:** Switch `wsFilesMatchesGlobs` to evaluate against the path *relative to the requested root* (i.e. the same `relPath` already accumulated during the recursive walk) using `github.com/bmatcuk/doublestar/v4`'s `PathMatch` (or equivalent). Basename patterns like `node_modules` or `*.log` keep working because `doublestar.PathMatch("node_modules", "src/foo/node_modules")` returns false — but `**/node_modules` and `**/*.log` would match anywhere, matching today's intent. Update existing callers to use `**/` prefix where they meant "at any depth."
- **Migration:** Audit existing callers and add `**/` prefix where their intent was "match at any depth" (`memory-service.ts`, `download.ts`, `DirectoryListingTool` defaults). Document the semantic change in the dev-supervisor PR.

### E3. Multi-path `stat` endpoint

- **Why:** `checkDependenciesInstalled` in PR #4375 (Stack A1) shoehorned "give me modifiedAt for these two files" into `tree({ includeGlobs: ['package.json', 'package-lock.json'] })`. That works but is awkward — globs are basename-only (E2 would partially fix it but adds complexity), and the call walks the whole root just to find two known names. A targeted endpoint is cleaner.
- **Change:** Add `POST /workspace/files/stat` taking `{ paths: string[] }` and returning `{ entries: Array<{ path, kind, size, modifiedAt } | { path, error: 'not_found' }> }`. Each path resolves independently; missing paths surface as a per-entry error rather than failing the whole call.
- **Caller updates:** `AppContextManager.checkDependenciesInstalled` switches to `workspace.files.stat({paths: ['package.json', 'package-lock.json']})` and reads `modifiedAt` from each entry. Lower priority than E1/E2 (only one caller benefits today).

---

## Series D — Cleanup (after A and B land)

### D1. Drop vestigial `app.path` from the `apps` table

- **Why:** Once all preview-fs reads route through `workspace.files`/`workspace.tasks` (which use `/app` internally), nothing reads `app.path` for filesystem purposes. The column stays as a misleading signal.
- **Change:**
  - Audit all readers of `app.path` post-Stack-A. The remaining ones should all be passing it as a logical key (e.g., GitTool's queue key) — those can switch to `appId`.
  - Schema migration: drop the `path` column; remove from `RegisterAppParams`, `App`, `findById` projection, etc.
- **Test plan:** typecheck guides most of the work; one schema migration test.

---

## Sequencing Recommendation

```
Merge order:
  PR #4345 (merged)
    └── PR #4375 — Stack A (in review):  A1 → A2 → A3
        ├── Series B (parallel):   B1, B2, B3, B4
        ├── Series C (parallel):   C1, C2, C3, C4
        ├── Series E (dev-supervisor PRs, parallel):  E1, E2, E3
        └── Series D (after A+B):  D1
```

- **B1, B2** are 1–2 line fixes each; bundle into one PR if convenient.
- **B3, B4** are real workspace migrations; keep separate for review surface. **B4 benefits from E2 (path-aware globs);** doable without it but the exclude list gets uglier.
- **C1–C4** are independent hardening PRs; can interleave with B series.
- **E1–E3** land in `dev-supervisor/`, not `agents/` — no ordering constraint with B/C/D, but each shrinks the callers that come after.
- **D1** is the capstone — only do after all preview-fs reads route through workspace, otherwise you'll break readers that quietly depended on `app.path`.

## Out of Scope

- Changes to local-control-plane Docker layout — already correct (preview/.git symlink removed in PR #4345).
- Production deployment topology — the migration is purely an agent-side discipline change; no Nomad job updates needed.

## Verification Pattern

For each PR in this plan, the verification convention established in PR #4345 applies:
- Strict Map-keyed workspace mocks in tests (rejects unknown paths) — see `download.test.ts` `strictWorkspace` helper.
- Tests assert that supervisor failures `.rejects.toThrow` rather than silently returning empty/null.
- `pnpm --filter @airo/agents typecheck && lint && test:unit` is the gate.

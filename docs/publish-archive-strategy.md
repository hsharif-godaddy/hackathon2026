# Design Proposal: PaaS Publish Flow - Archive Strategy Detection

## Problem Statement

PaaS apps that don't produce a bundled server file (`dist/server.bundle.cjs`) fail to publish with the error:

```
package.json not found. Archive may be corrupted or invalid.
```

**Root Cause:** The publish archive currently contains only the `dist/` folder. Production's `build-and-run.sh` has two code paths:

- **Fast path:** If `dist/server.bundle.cjs` exists, run it directly
- **Fallback path:** If not, run a full build from source using `package.json`

The fallback path fails because `package.json` and source files are not included in the archive.

**Note:** The local publish container script (`container-scripts/publish/run-app.sh`) does not implement this fallback behavior — it always assumes `dist/server.bundle.cjs` exists. Full-source archives work only in production environments.

**Context:** [PR #1641](https://github.com/gdcorp-partners/airo-app-builder/pull/1641) introduced the dist-only archive optimization, which works well for AAB apps using the v8 template (which produces `dist/server.bundle.cjs`). However, the optimization didn't account for PaaS apps that may not produce this bundled file. This proposal addresses that gap by detecting the build output and choosing the appropriate archive strategy.

## Proposed Solution

Implement **auto-detection** in `createArchive()` to dynamically choose the archive strategy based on build output:

| Condition                        | Archive Strategy | Rationale                                            |
| -------------------------------- | ---------------- | ---------------------------------------------------- |
| `dist/server.bundle.cjs` exists  | `dist/` only     | Fast path works - bundled server is self-contained   |
| `dist/server.bundle.cjs` missing | Full source      | Fallback path needs source to run `build-and-run.sh` |

**Key Design Decision:** Auto-detect by default, with explicit override capability.

- Callers don't need to implement detection logic
- Explicit `includeSource: true/false` skips auto-detection (useful for testing or special cases)
- Detection logic is encapsulated in `GitUtils.createArchive()`

## Files to Modify

### 1. `agents/src/utils/git.ts`

Add `ArchiveOptions` interface and modify `createArchive()` to auto-detect archive strategy.

**New interface:**

```typescript
export interface ArchiveOptions extends GitCommandOptions {
  /**
   * When true, includes full source code (for apps without bundled server).
   * When false, includes only dist/ folder (for apps with bundled server).
   * When undefined (default), auto-detects based on dist/server.bundle.cjs presence.
   */
  includeSource?: boolean;
}
```

**Updated signature:**

```typescript
async createArchive(
  repoPath: string,
  commitHash: string,
  outputDir: string = process.env.DIST_DIR || '/publish/dist',
  options: ArchiveOptions = {}
): Promise<GitArchiveResult>
```

### 2. `agents/src/server/routes/publish.ts`

For the default flow, no changes required - `createArchive()` auto-detects the appropriate strategy.

For PaaS flow (`deploymentStrategy: "paas"`), explicitly pass `{ includeSource: true }` to force full-source archives regardless of auto-detection.

## Detailed Design

### Auto-Detection Logic (inside createArchive)

```typescript
// Determine archive strategy: auto-detect or use explicit override
let includeSource: boolean;
if (options.includeSource !== undefined) {
  // Explicit override - skip auto-detection
  includeSource = options.includeSource;
} else {
  // Auto-detect based on bundled server presence
  const bundleCheckResult = await this.devSupervisor!.exec({
    command: buildShellCommand(["test", "-f", "dist/server.bundle.cjs"]),
    working_dir: "/app",
    timeout: 5,
    capture_output: true,
  });
  includeSource = !bundleCheckResult.success; // Include source if bundle NOT found
}
```

### Archive Creation Logic

#### When `includeSource: false` (dist-only)

Archive only the `dist/` folder:

```bash
tar -czf {archivePath} -C /app dist
```

**Contents:**

- `dist/` (bundled JavaScript, copied media, etc.)
- `airo-media.json` copied into `dist/` if exists

#### When `includeSource: true` (full source)

Archive full source with exclusions:

```bash
tar -czf {archivePath} \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.env.local' \
  -C /app .
```

**Contents included:**

- `package.json` (required)
- `package-lock.json` / `pnpm-lock.yaml` / `bun.lockb` (lockfiles)
- `src/` (source code)
- `dist/` (build output)
- `.airo/` (custom config)
- `drizzle/` (database migrations)
- `public/` (static assets)
- `vite.config.*`, `tsconfig.json`, `postcss.config.*`, `tailwind.config.*` (config files)
- `index.html` (entry point)
- `airo-media.json` (media manifest, if exists)

**Contents excluded:**

- `node_modules/` (will be installed on deploy)
- `.git/` (version control data)
- `.env*` files (secrets - must not be in archive)

### Usage in publish.ts

```typescript
// Simple usage - auto-detects based on build output
const archiveResult = await gitUtils.createArchive(
  app.path,
  fullCommitHash,
  targetDir,
);

// Explicit override (for testing or special cases)
const archiveResult = await gitUtils.createArchive(
  app.path,
  fullCommitHash,
  targetDir,
  { includeSource: true }, // Force full source
);
```

## Scenarios Handled

| App Type              | Build Output              | Auto-Detected Strategy | Production Behavior                     |
| --------------------- | ------------------------- | ---------------------- | --------------------------------------- |
| AAB v8 template       | `dist/server.bundle.cjs`  | dist/ only             | Fast path: runs bundled server directly |
| PaaS with bundling    | `dist/server.bundle.cjs`  | dist/ only             | Fast path: runs bundled server directly |
| PaaS without bundling | `dist/app.js` (no bundle) | Full source            | Fallback: runs `build-and-run.sh`       |
| Legacy AAB            | No server bundle          | Full source            | Fallback: runs `build-and-run.sh`       |

## Edge Cases

1. **PaaS app with custom server.bundle.cjs location** - Detection checks exact path; custom locations won't match. Fallback to full source is safe.

2. **Empty dist/ after build** - Existing validation catches this before archive creation.

3. **Missing package.json in source** - Build would have failed earlier; this case can't reach archive creation.

4. **Large node_modules** - Explicitly excluded from archive in both strategies.

5. **Secrets in .env files** - Explicitly excluded via `--exclude=.env*` patterns.

## Testing Strategy

### Unit Tests (`agents/src/utils/__tests__/git.test.ts`)

**Auto-detect tests:**

1. **Auto-detect dist-only** - When `dist/server.bundle.cjs` exists, verify dist-only archive
2. **Auto-detect full-source** - When `dist/server.bundle.cjs` missing, verify full source archive

**Explicit override tests:**

3. **Override with `includeSource: false`** - Skip auto-detect, use dist-only
4. **Override with `includeSource: true`** - Skip auto-detect, use full source

**Full source behavior tests:**

5. **Exclusions** - Verify `node_modules`, `.git`, `.env*` are excluded
6. **Root archive** - Verify archives from `.` not `dist/`
7. **Skip manifest copy** - Verify `airo-media.json` not copied (included in full archive)

### Manual Testing

```bash
# 1. Publish a PaaS app without bundling (e.g., harvestbox)
curl -X POST http://localhost:4000/apps/{appId}/publish \
  -H "Authorization: Bearer {token}"

# 2. Check archive contents
tar -tzf /tmp/airo-app-builder/{appId}/dist/{hash}.tar.gz | head -20

# 3. Verify package.json is included for non-bundled apps
tar -tzf /tmp/airo-app-builder/{appId}/dist/{hash}.tar.gz | grep package.json
```

## Rollback Plan

If issues arise after deployment:

**Immediate:** Force full source by passing explicit override in publish.ts:

```typescript
const archiveResult = await gitUtils.createArchive(
  app.path,
  fullCommitHash,
  targetDir,
  { includeSource: true }, // Force full source until stable
);
```

**Long-term:** Revert to pre-PR #1641 behavior if needed.

## Performance Impact

| Scenario               | Current             | Proposed                    | Impact                       |
| ---------------------- | ------------------- | --------------------------- | ---------------------------- |
| AAB apps (v8 template) | dist/ only          | dist/ only (auto-detected)  | +1 exec call for detection   |
| PaaS with bundling     | dist/ only          | dist/ only (auto-detected)  | +1 exec call for detection   |
| PaaS without bundling  | dist/ only (broken) | Full source (auto-detected) | +1 exec call, larger archive |

The detection adds ~10ms overhead per publish. Full source archives are larger but only for apps that require them.

## Security Considerations

1. **Secrets exclusion** - `.env*` files are explicitly excluded from full source archives
2. **node_modules exclusion** - Prevents potential malicious packages from being deployed
3. **No new attack surface** - Detection uses existing devSupervisor exec pattern

## References

- [PR #1641](https://github.com/gdcorp-partners/airo-app-builder/pull/1641): Original change that introduced dist-only archives
- Production `build-and-run.sh`: Handles both fast path and fallback scenarios
- v8 template: Standard AAB template that produces `dist/server.bundle.cjs`

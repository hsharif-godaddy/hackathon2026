# PaaS Publish Flow Optimization

---

## 1. Objective & Improvements

### AAB vs PaaS Rationale

| Aspect               | AAB                                                                           | PaaS                                                                         |
| -------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Control**          | High - we control templates, build process, and output                        | Low - customer brings unknown app structure                                  |
| **Archive Strategy** | Dist-only (changed from full archive) - we know exactly what `/dist` contains | Full archive (node_modules + dist) - preserve customer's working environment |
| **Why**              | We generate the app, so we can guarantee `/dist` has everything needed        | Customer apps vary widely - safest to preserve what worked in preview        |

**Historical note**: AAB originally used full source archives but was optimized to copy only `/dist` to publish since we control the build output. PaaS cannot make this assumption.

### Problem Statement

The current PaaS publish flow performs **redundant operations** that:

1. Waste compute resources (npm install + build run 3 times)
2. Introduce potential for environment-specific failures (preview works, publish fails)
3. Increase publish latency unnecessarily

### Root Cause Example

App `je8coccma0` demonstrated this issue:

- **Preview**: Vite dev server worked perfectly
- **Publish**: `vite build` failed with `react/jsx-runtime` not found

The failure occurred because publish ran a fresh `npm install` + `npm build` in an isolated context, rather than using the already-working preview environment.

### Objectives

| Objective                                    | Benefit                                  |
| -------------------------------------------- | ---------------------------------------- |
| Eliminate redundant `npm install` in publish | Faster publish, less compute             |
| Eliminate redundant `npm build` in publish   | Faster publish, guaranteed consistency   |
| Include `node_modules` + `dist/` in archive  | What works in preview = works in publish |
| Reduce publish latency                       | Better user experience                   |

### Expected Improvements

| Metric                 | Current                             | After Optimization        |
| ---------------------- | ----------------------------------- | ------------------------- |
| Publish time (typical) | 30-60s                              | 5-10s                     |
| npm install calls      | 2 (preview + publish)               | 1 (preview only)          |
| npm build calls        | 3 (import + prepareBuild + publish) | 1 (import only)           |
| Environment parity     | Different installs may differ       | Identical (same binaries) |

---

## 2. Current State vs New State

### Current PaaS Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ZIP IMPORT (Preview)                         │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Extract zip to /app                                              │
│ 2. npm install --include=dev                          ← INSTALL #1  │
│ 3. npm run build                                      ← BUILD #1    │
│ 4. git commit                                                       │
│ 5. Start dev server (vite)                                          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PUBLISH - prepareBuild() (Agent)                  │
├─────────────────────────────────────────────────────────────────────┤
│ 1. npm run build                                      ← BUILD #2    │
│ 2. Create archive (EXCLUDES node_modules)             ← REDUNDANT   │
│ 3. Save to /dist/{commitHash}.tar.gz                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PUBLISH - build-and-run.sh (Publish)                │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Extract archive to /app                                          │
│ 2. npm install                                        ← INSTALL #2  │
│ 3. npm run build                                      ← BUILD #3    │
│ 4. npm start                                                        │
└─────────────────────────────────────────────────────────────────────┘

Total: 2 installs, 3 builds
```

### New PaaS Flow (Optimized)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ZIP IMPORT (Preview)                         │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Extract zip to /app                                              │
│ 2. npm install --include=dev                          ← INSTALL     │
│ 3. npm run build                                      ← BUILD       │
│ 4. git commit                                                       │
│ 5. Start dev server (vite)                                          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PUBLISH - prepareBuild() (Agent)                  │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Skip build (already done in import)                ← REMOVED     │
│ 2. Create archive (INCLUDES node_modules + dist/)     ← CHANGED     │
│ 3. Save to /dist/{commitHash}.tar.gz                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PUBLISH - run-app.sh (Publish)                      │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Extract archive to /app (has node_modules + dist/) │             │
│ 2. Skip npm install                                   ← REMOVED     │
│ 3. Skip npm build                                     ← REMOVED     │
│ 4. npm start (or node dist/index.js)                  ← DIRECT RUN  │
└─────────────────────────────────────────────────────────────────────┘

Total: 1 install, 1 build
```

---

## 3. Code Changes

### 3.1 PaaSPublishStrategy.ts - Skip Redundant Build

**File**: `agents/src/server/routes/publish/strategies/PaaSPublishStrategy.ts`

**Current** (lines 67-99):

```typescript
async prepareBuild(context: PublishContext): Promise<BuildResult> {
  const { logger, devSupervisor, gitUtils, appPath, targetDir } = context;

  // Generate hex timestamp identifier
  const commitHash = Date.now().toString(16).padStart(12, '0');

  // Detect package manager
  const packageManager = await detectPackageManager(devSupervisor);
  const buildCommand = getBuildCommand(packageManager, true);

  // Build the application  ← REDUNDANT FOR PAAS
  logger.info(`route.publish.${this.key}.build.begin`, { ... });

  const buildResult = await devSupervisor.exec({
    command: buildCommand,
    working_dir: '/app',
    timeout: 120,
    capture_output: true,
  });

  if (!buildResult.success) {
    throw new BuildError(...);
  }

  // Create archive
  const archiveResult = await gitUtils.createArchive(
    appPath,
    commitHash,
    targetDir,
    { includeSource: true, excludeUntracked: true }
  );

  return { commitHash, archivePath: archiveResult.path };
}
```

**New**:

```typescript
async prepareBuild(context: PublishContext): Promise<BuildResult> {
  const { logger, devSupervisor, gitUtils, appPath, targetDir } = context;

  // Generate hex timestamp identifier
  const commitHash = Date.now().toString(16).padStart(12, '0');
  logger.info(`route.publish.${this.key}.git-skipped`, {
    identifier: commitHash,
    message: 'PaaS strategy: skipping git operations',
  });

  // PaaS: Skip build - already done during zip import
  // The app is already built and validated in preview
  logger.info(`route.publish.${this.key}.build.skipped`, {
    reason: 'PaaS flow: build completed during zip import',
  });

  // Validate dist/ exists (sanity check)
  const distCheck = await devSupervisor.exec({
    command: 'test -d /app/dist',
    working_dir: '/app',
    timeout: 5,
    capture_output: true,
  });

  if (!distCheck.success) {
    logger.error(`route.publish.${this.key}.dist-missing`, {});
    throw new BuildError(
      'dist/ directory not found',
      'Build may not have completed during import. Try re-importing the zip.',
      1
    );
  }

  // Create archive INCLUDING node_modules and dist/
  const archiveResult = await gitUtils.createArchive(
    appPath,
    commitHash,
    targetDir,
    {
      includeSource: true,
      excludeUntracked: true,
      includeNodeModules: true,  // NEW FLAG
    }
  );

  logger.info(`route.publish.${this.key}.archive.success`, {
    commitHash: commitHash.substring(0, 7),
    archivePath: archiveResult.path,
    includesNodeModules: true,
  });

  return { commitHash, archivePath: archiveResult.path };
}
```

---

### 3.2 git.ts - Add includeNodeModules Option

**File**: `agents/src/utils/git.ts`

**Add to ArchiveOptions interface** (~line 75):

```typescript
export interface ArchiveOptions {
  timeout?: number;
  includeSource?: boolean;
  excludeUntracked?: boolean;
  includeNodeModules?: boolean; // NEW: Include node_modules in archive (PaaS)
}
```

**Modify createFullSourceArchive** (~line 703):

```typescript
private async createFullSourceArchive(
  archivePath: string,
  outputDir: string,
  timeout: number,
  excludeUntracked: boolean,
  includeNodeModules: boolean = false  // NEW PARAMETER
): Promise<void> {
  // Create output directory
  const mkdirResult = await this.devSupervisor!.exec({
    command: buildShellCommand(['mkdir', '-p', outputDir]),
    working_dir: '/app',
    timeout: 10,
    capture_output: true
  });
  if (!mkdirResult.success) {
    throw new Error(`Failed to create output directory: ${mkdirResult.stderr || 'Unknown error'}`);
  }

  const untrackedExclusions = !excludeUntracked
    ? []
    : await this.getUntrackedExclusions();

  // Build tar exclusions
  const tarExclusions = [
    '--exclude=.git',  // Always exclude .git
  ];

  // Only exclude node_modules if NOT including them (default behavior)
  if (!includeNodeModules) {
    tarExclusions.push('--exclude=node_modules');
  }

  // Create tar.gz archive
  const tarArgs = [
    'tar', '-czf', archivePath,
    ...tarExclusions,
    ...untrackedExclusions.map(file => `--exclude=${file}`),
    '-C', '/app', '.'
  ];

  logger.info('git.archive.create.start', {
    archivePath,
    includeNodeModules,
    exclusionCount: tarExclusions.length + untrackedExclusions.length,
  });

  const tarResult = await this.devSupervisor!.exec({
    command: buildShellCommand(tarArgs),
    working_dir: '/app',
    timeout: Math.floor(timeout / 1000),
    capture_output: true
  });

  if (!tarResult.success) {
    throw new Error(`Failed to create archive: ${tarResult.stderr || 'Unknown error'}`);
  }
}
```

**Update createArchive caller** (~line 616):

```typescript
if (includeSource) {
  await this.createFullSourceArchive(
    archivePath,
    outputDir,
    timeout,
    options.excludeUntracked === true,
    options.includeNodeModules === true, // NEW: Pass flag
  );
} else {
  await this.createDistOnlyArchive(archivePath, outputDir, timeout);
}
```

---

### 3.3 run-app.sh - Detect Pre-packaged Archive

**File**: `container-scripts/publish/run-app.sh`

**Add detection after extraction** (~line 72):

```bash
# Extract archive
log "Extracting archive to: $APP_DIR"
tar zxf "$ARCHIVE_PATH" -C "$APP_DIR" || error_exit "Failed to extract archive"
log "Archive extracted successfully"

# Change to app directory
cd "$APP_DIR" || error_exit "Failed to change directory to $APP_DIR"

# ============================================================================
# ARCHIVE TYPE DETECTION
# ============================================================================
# Archives can be:
# 1. Pre-built bundle (server.bundle.mjs) → fast path, just run
# 2. PaaS full-package (node_modules + dist/) → medium path, just start
# 3. Source-only (no node_modules) → slow path, install + build + start
# ============================================================================

if [[ -f "${APP_DIR}/dist/server.bundle.mjs" ]]; then
    # AAB pre-built bundle - fastest path
    log "Detected pre-built bundle (server.bundle.mjs) - using fast path"
    load_customer_environment_variables
    create_env_file "${APP_DIR}/dist"
    cd "${APP_DIR}/dist" || error_exit "Failed to change to dist directory"
    exec /usr/local/bin/node "${APP_DIR}/dist/server.bundle.mjs"

elif [[ -f "${APP_DIR}/dist/server.bundle.cjs" ]]; then
    # AAB legacy bundle - fast path
    log "Detected pre-built bundle (server.bundle.cjs) - using legacy fast path"
    load_customer_environment_variables
    create_env_file "${APP_DIR}/dist"
    cd "${APP_DIR}/dist" || error_exit "Failed to change to dist directory"
    exec /usr/local/bin/node "${APP_DIR}/dist/server.bundle.cjs"

elif [[ -d "${APP_DIR}/node_modules" && -d "${APP_DIR}/dist" ]]; then
    # PaaS full-package - node_modules + dist included
    # Skip install and build, just start
    log "Detected PaaS full-package archive (node_modules + dist present)"
    log "Skipping npm install and build - using pre-packaged dependencies"

    load_customer_environment_variables

    # Run database migrations if applicable
    run_migrations_if_needed

    # Detect start command
    CUSTOM_SERVE_CMD=""
    if [[ -f ".airo/config.json" ]]; then
        CUSTOM_SERVE_CMD=$(jq -er '.runtime.serve.command // empty' .airo/config.json 2>/dev/null || echo "")
    fi

    if [[ -n "$CUSTOM_SERVE_CMD" ]]; then
        log "Using custom serve command: $CUSTOM_SERVE_CMD"
        exec sh -c "$CUSTOM_SERVE_CMD"
    else
        # Find entry point
        ENTRY_FILE=""
        for candidate in "dist/app.js" "dist/index.js" "dist/server.js" "dist/main.js"; do
            if [[ -f "${APP_DIR}/${candidate}" ]]; then
                ENTRY_FILE="${candidate}"
                break
            fi
        done

        if [[ -z "$ENTRY_FILE" ]]; then
            # Fallback to npm start
            log "No entry point found in dist/, using npm start"
            exec npm start
        fi

        log "Starting with entry point: ${ENTRY_FILE}"
        create_env_file "${APP_DIR}/dist"
        cd "${APP_DIR}/dist" || error_exit "Failed to change to dist directory"
        exec /usr/local/bin/node "./${ENTRY_FILE##*/}"
    fi

else
    # Source-only archive - needs full build
    log "No pre-built artifacts or node_modules detected"
    log "Delegating to build-and-run.sh for install + build"
    exec /publish/build-and-run.sh
fi
```

**Extract migration logic to reusable function** (add to `common.sh`):

```bash
# Run database migrations if drizzle folder exists and config is available
run_migrations_if_needed() {
    local CONFIG_PATH="${NOMAD_ALLOC_DIR}/config.json"

    if [[ ! -f "$CONFIG_PATH" ]]; then
        log "Skipping migrations - no allocation config"
        return 0
    fi

    if [[ ! -d "drizzle" ]]; then
        log "Skipping migrations - no drizzle folder"
        return 0
    fi

    if grep -q '"db:migrate"' package.json; then
        log "Running database migrations (db:migrate)"
        npm run db:migrate || error_exit "Migration failed"
    elif grep -q '"db:push"' package.json; then
        log "Running database migrations (db:push)"
        npm run db:push || error_exit "Migration failed"
    else
        log "No migration script found"
    fi
}
```

---

## 4. Edge Scenarios

### 4.1 Container Crash During Extraction

**Scenario**: Publish container crashes mid-extraction. **Mitigation**: Supervisor stops process before extraction; on restart, extraction retries from clean archive. Risk window is small—defer atomic swap to future if needed.

### 4.2 Native Modules Compatibility

**Scenario**: Customer uses native modules (sharp, better-sqlite3, etc.)

**Risk**: Binaries compiled in preview may not work in publish if environments differ.

**Assumption**: Preview and Publish containers are **identical environments**:

- Same Node.js version
- Same OS/architecture
- Same container image

**Note**: This is an architectural assumption. If preview/publish environments ever diverge, native modules may fail. Current architecture guarantees parity.

### 4.3 Rollback to Previous Version

**Scenario**: V2 has issues, need to rollback to V1.

**Current Support**: Symlink can be updated to point to older archive.

```bash
# In /dist directory
ln -sf v1-hash.tar.gz current
# Restart publish container
```

**With node_modules included**: Works identically. Each archive is self-contained.

### 4.4 devDependencies in Production

**Scenario**: Archive includes devDependencies from preview.

**Analysis**:

- Preview runs: `npm install --include=dev`
- Archive includes all of node_modules
- Publish gets devDependencies too

**Impact**:

- Slightly larger archive (includes dev tools)
- No runtime impact (devDeps not loaded unless imported)
- Acceptable tradeoff for consistency

**Future Optimization** (Optional):

```bash
# Before creating archive, prune devDependencies
npm prune --production
# Then create archive
# Then reinstall for preview
npm install --include=dev
```

**Decision**: Defer pruning. Size increase acceptable vs. complexity.

### 4.5 .env File Handling

**Scenario**: Customer has `.env` file with custom variables.

**Behavior**:

- Root-level `.env*` files ARE included in archive
- Platform secrets come from `/alloc/config.json` → set in process.env
- dotenv loads `.env` but does NOT override existing process.env

**Precedence**: `process.env (platform) > .env (customer)`

**Result**: Platform secrets take priority, customer custom vars are honored.

### 4.6 Zip Import Fails Build, User Publishes Anyway

**Scenario**: Zip import's build step failed, but user still clicks publish.

**Mitigation**: Added dist/ check in `prepareBuild()`:

```typescript
const distCheck = await devSupervisor.exec({
  command: "test -d /app/dist",
  working_dir: "/app",
  timeout: 5,
  capture_output: true,
});

if (!distCheck.success) {
  throw new BuildError(
    "dist/ directory not found",
    "Build may not have completed during import. Try re-importing the zip.",
    1,
  );
}
```

---

## 5. Considerations & Assumptions

### 5.1 Storage (Ceph)

| Factor                   | Impact                                               |
| ------------------------ | ---------------------------------------------------- |
| Archive size increase    | ~10x larger with node_modules (50MB → 500MB typical) |
| Multiple versions stored | Each version is self-contained                       |
| Retention policy         | Recommend keeping last N versions (e.g., 5)          |

**Recommendation**: Implement archive cleanup job that removes old versions beyond retention limit.

```typescript
// Future: Add to publish flow or scheduled job
async function cleanupOldArchives(distDir: string, keepCount: number = 5) {
  const archives = await glob(`${distDir}/*.tar.gz`);
  const sorted = archives.sort(
    (a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime(),
  );

  for (const archive of sorted.slice(keepCount)) {
    if (!archive.endsWith("/current")) {
      await fs.unlink(archive);
    }
  }
}
```

### 5.2 Environment Parity Assumption

**Critical Assumption**: Preview and Publish containers are identical.

| Aspect               | Requirement  |
| -------------------- | ------------ |
| Node.js version      | Must be same |
| OS/architecture      | Must be same |
| Base container image | Must be same |
| npm/pnpm version     | Must be same |

**If violated**: Native modules may fail. This is existing architecture guarantee.

### 5.3 Build Output Location

**Assumption**: Build outputs to `dist/` directory.

**Custom builds**: Supported via `.airo/config.json`:

```json
{
  "runtime": {
    "serve": {
      "command": "node build/server.js"
    }
  }
}
```

### 5.4 Git Tracking

**Clarification**: Git is still used in PaaS flow for:

- Version history
- Rollback capability
- Code tracking

**Not committed to git**:

- `node_modules/` (in .gitignore)
- `dist/` (in .gitignore)

**Committed to git**:

- Source code
- package.json, lock files
- Configuration

### 5.5 AAB Flow Unchanged

**Scope**: These changes apply to **PaaS flow only**.

**AAB flow** (user develops in-app):

- Continues to use source-only archives
- Build happens in publish container
- No changes to existing behavior

**Detection**: Strategy pattern already separates flows:

- `PaaSPublishStrategy` → New behavior (include node_modules)
- `DefaultPublishStrategy` → Existing behavior (source only)

---

## 6. Summary

| Change               | File                     | Description                                     |
| -------------------- | ------------------------ | ----------------------------------------------- |
| Skip redundant build | `PaaSPublishStrategy.ts` | Remove build step, add dist/ validation         |
| Include node_modules | `git.ts`                 | Add `includeNodeModules` option to archive      |
| Fast-path detection  | `run-app.sh`             | Detect full-package archive, skip install/build |
| Migration extraction | `common.sh`              | Reusable migration function                     |

**Result**: PaaS publish goes from ~60s to ~10s, with guaranteed environment parity.

---

## 7. Performance Validation

### 7.1 npm install vs tar extraction

This section validates the optimization with data and theoretical analysis.

#### Documented Timings (from codebase)

| Operation                           | Typical Duration  | Source                                                                  |
| ----------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| `npm install` (fresh, 200+ deps)    | **1-3 minutes**   | `docs/superpowers/specs/2026-03-17-git-recovery-coordination-design.md` |
| `npm install` (restart, cached)     | **30-60 seconds** | `docs/superpowers/specs/2026-03-17-setup-execute-endpoint-design.md`    |
| `npm install` timeout               | **5 minutes**     | `docs/paas/paas-threat-model-doc.md`                                    |
| Current publish (install + build)   | **30-60 seconds** | This document                                                           |
| Optimized publish (extraction only) | **5-10 seconds**  | This document                                                           |

#### Theoretical Breakdown: npm install

| Phase                   | Bottleneck                          | 500MB node_modules  | 1GB node_modules    |
| ----------------------- | ----------------------------------- | ------------------- | ------------------- |
| Registry resolution     | Network RTT × dependency count      | 5-15 seconds        | 10-25 seconds       |
| Package download        | Network bandwidth (~50-100 MB/s)    | 5-10 seconds        | 10-20 seconds       |
| Dependency resolution   | CPU (package-lock parsing)          | 2-5 seconds         | 3-8 seconds         |
| Extract to node_modules | Disk I/O (thousands of small files) | 30-60 seconds       | 60-120 seconds      |
| Post-install scripts    | CPU + I/O                           | 5-30 seconds        | 10-45 seconds       |
| **Total**               |                                     | **~60-120 seconds** | **~90-220 seconds** |

**Key insight**: npm install isn't just downloading—it's extracting thousands of individual files, running gyp builds, executing postinstall scripts. The file count (50,000-200,000 files for 500MB, 100,000-400,000 for 1GB) dominates I/O time.

#### Theoretical Breakdown: tar extraction from Ceph

| Phase                       | Bottleneck                  | 500MB archive     | 1GB archive        |
| --------------------------- | --------------------------- | ----------------- | ------------------ |
| Ceph read (network storage) | Network (~100-200 MB/s)     | 2-5 seconds       | 5-10 seconds       |
| gzip decompression          | CPU (single stream)         | 1-3 seconds       | 2-6 seconds        |
| Write to /app               | Disk I/O (sequential write) | 2-5 seconds       | 4-10 seconds       |
| **Total**                   |                             | **~5-15 seconds** | **~10-25 seconds** |

**Key insight**: tar writes files sequentially in a single stream—bulk operation vs npm's thousands of tiny writes. Even at 1GB, extraction is 4-9x faster than npm install.

#### Why tar extraction is 6-10x faster

| Factor                   | npm install                      | tar extraction                |
| ------------------------ | -------------------------------- | ----------------------------- |
| **Network requests**     | Hundreds (one per package)       | One (single file)             |
| **File operations**      | 50,000-200,000 small files       | ~10,000 files (bulk)          |
| **I/O pattern**          | Random writes (many small files) | Sequential write (one stream) |
| **Metadata overhead**    | High (npm registry, checksums)   | Low (tar header only)         |
| **Script execution**     | Yes (postinstall, gyp builds)    | No                            |
| **Lock file resolution** | Yes (dependency tree)            | No                            |

### 7.2 Agent-Level Instrumentation

Add timing and size measurement to `PaaSPublishStrategy.ts` for production metrics:

```typescript
// In prepareBuild() - measure archive creation
const archiveStart = Date.now();
const archiveResult = await gitUtils.createArchive(
  appPath,
  commitHash,
  targetDir,
  { includeSource: true, excludeUntracked: true, includeNodeModules: true },
);
const archiveMs = Date.now() - archiveStart;

// Get archive size via dev-supervisor
const statResult = await devSupervisor.exec({
  command: `stat -c '%s' ${archiveResult.path}`,
  working_dir: "/dist",
  timeout: 5,
  capture_output: true,
});
const archiveSizeMB = parseInt(statResult.stdout.trim()) / (1024 * 1024);

logger.info(`route.publish.${this.key}.archive.benchmark`, {
  commitHash: commitHash.substring(0, 7),
  archiveSizeMB: archiveSizeMB.toFixed(2),
  archiveCreationMs: archiveMs,
  throughputMBps: (archiveSizeMB / (archiveMs / 1000)).toFixed(2),
  includesNodeModules: true,
});
```

### 7.3 Metrics Implementation

**Status**: Implemented in PR [#2975](https://github.com/gdcorp-partners/airo-app-builder/pull/2975)

Metrics are now captured at multiple levels:

| Metric              | Location                  | Log Event                         |
| ------------------- | ------------------------- | --------------------------------- |
| `extractDurationMs` | `run-app.sh`              | Logged after extraction completes |
| `installDurationMs` | `ProjectImportService.ts` | `project-import.metrics`          |
| `buildDurationMs`   | `ProjectImportService.ts` | `project-import.metrics`          |
| `appDirSizeBytes`   | `AppRestartService.ts`    | `app-restart.cycle.metrics`       |

Search Elasticsearch for these log events to analyze real-world performance.

### 7.4 Size Comparison Summary

| Archive Size | npm install    | tar extraction | Speedup   |
| ------------ | -------------- | -------------- | --------- |
| **500MB**    | 60-120 seconds | 5-15 seconds   | **6-10x** |
| **1GB**      | 90-220 seconds | 10-25 seconds  | **4-9x**  |

**Note**: Speedup ratio decreases slightly at larger sizes because tar's sequential I/O scales linearly, while npm's overhead (registry, scripts) doesn't scale as badly. Still a significant win at any size.

### 7.5 Validation Summary

| Claim                                       | Evidence                                            |
| ------------------------------------------- | --------------------------------------------------- |
| "tar extraction is faster than npm install" | 5-15s vs 60-120s at 500MB; 10-25s vs 90-220s at 1GB |
| "4-10x improvement expected"                | Matches theoretical I/O analysis across size range  |
| "Environment parity guaranteed"             | Same container image, same binaries                 |
| "Native modules will work"                  | Preview/Publish identical (same Node, OS, arch)     |

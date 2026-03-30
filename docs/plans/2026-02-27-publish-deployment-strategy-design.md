---
status: implemented
---

# Design: Publish Deployment Strategy Pattern

## Problem Statement

The current publish flow in `publish.ts` is tightly coupled to AAB (Airo App Builder) requirements:

- Full git operations (merge to main, commit verification, branch cleanup)
- Dist-only archive strategy (assumes `server.bundle.cjs` exists)

PaaS apps have different requirements:

- No git operations needed (code is uploaded directly, not developed in-app)
- Full source archive needed (no `server.bundle.cjs`, needs `package.json` for `npm install`)

**Current Error for PaaS:**

```
package.json not found. Archive may be corrupted or invalid.
```

**Root Cause:** The archive contains only `dist/` folder, but PaaS apps need full source for the publish container's fallback build path.

**Context:** [PR #1641](https://github.com/gdcorp-partners/airo-app-builder/pull/1641) introduced dist-only archive optimization for AAB apps. This works for AAB's v8 template (produces `dist/server.bundle.cjs`) but breaks PaaS apps that don't produce this bundled file.

## Proposed Solution

Implement a **Strategy Pattern** for the publish flow with two strategies:

| Strategy  | Git Operations                      | Archive Type                             | Use Case                    |
| --------- | ----------------------------------- | ---------------------------------------- | --------------------------- |
| `default` | Full (merge to main, verify commit) | Auto-detect based on `server.bundle.cjs` | AAB apps (developed in-app) |
| `paas`    | None                                | Full source (`includeSource: true`)      | PaaS apps (uploaded code)   |

**API Contract:**

```typescript
POST /apps/:id/publish
Body: {
  deploymentStrategy?: 'default' | 'paas'  // defaults to 'default' if not provided
}
```

**Backward Compatibility:** Existing callers without `deploymentStrategy` param continue to use `default` strategy (current AAB behavior).

## File Structure

```
agents/src/server/routes/publish/
├── strategies/
│   ├── PublishStrategy.ts        # Interface + types + factory
│   ├── DefaultPublishStrategy.ts # Full git ops + auto-detect archive
│   └── PaaSPublishStrategy.ts    # No git ops + full source archive
├── publish.ts                    # Route handler (thin orchestrator)
└── index.ts                      # Router export
```

## Detailed Design

### Interface Definition

```typescript
// strategies/PublishStrategy.ts

export type DeploymentStrategy = "default" | "paas";

export interface PublishContext {
  appId: string;
  appPath: string;
  outputDir: string;
  devSupervisor: DevSupervisorClient;
  gitUtils: GitUtils;
  logger: ReturnType<typeof log.forApp>;
}

export interface PublishResult {
  commitHash: string;
  archivePath: string;
}

export interface PublishStrategy {
  /**
   * Strategy identifier used for:
   * - Factory selection
   * - Log event formatting: `route.publish.{key}.event`
   */
  readonly key: DeploymentStrategy;

  /**
   * Execute the complete publish workflow.
   * Each strategy owns its entire workflow internally.
   *
   * - Default: git ops → build → auto-detect archive
   * - PaaS: build → full source archive (no git ops)
   */
  publish(context: PublishContext): Promise<PublishResult>;
}
```

**Design Rationale:**

- Single `publish()` method - each strategy owns its complete workflow
- `key` property - used for factory selection and log event formatting
- `PublishResult` - encapsulates what orchestrator needs without exposing internals
- Strategies can have completely different internal workflows

### Logging Convention

Strategies use `key` for consistent log event formatting:

```typescript
// Pattern: route.publish.{key}.{event}
logger.info(`route.publish.${this.key}.build.begin`, { appId });
logger.info(`route.publish.${this.key}.archive.success`, { archivePath });

// Examples:
// route.publish.default.merge-strategy
// route.publish.default.build.begin
// route.publish.paas.git-skipped
// route.publish.paas.archive.success
```

### Strategy Factory

```typescript
// strategies/PublishStrategy.ts

export function getPublishStrategy(strategy?: string | null): PublishStrategy {
  switch (strategy) {
    case "paas":
      return new PaaSPublishStrategy();
    case "default":
    case undefined:
    case null:
    default:
      return new DefaultPublishStrategy();
  }
}
```

### DefaultPublishStrategy (AAB Flow)

Encapsulates the complete AAB publish workflow:

```typescript
class DefaultPublishStrategy implements PublishStrategy {
  readonly key: DeploymentStrategy = "default";

  async publish(context: PublishContext): Promise<PublishResult> {
    const { logger } = context;

    // 1. Git operations (merge to main if needed)
    const commitHash = await this.ensureMainBranch(context);

    // 2. Build
    logger.info(`route.publish.${this.key}.build.begin`, {});
    await this.build(context);

    // 3. Create archive (auto-detect strategy)
    const archivePath = await this.createArchive(context, commitHash);

    return { commitHash, archivePath };
  }

  // Private methods for internal workflow
  private async ensureMainBranch(context): Promise<string> { ... }
  private async build(context): Promise<void> { ... }
  private async createArchive(context, commitHash): Promise<string> { ... }
}
```

**Internal workflow:**

1. Get current branch, merge to main if on feature branch
2. Run `NODE_ENV=production npm run build`
3. Create archive with auto-detect (dist-only if `server.bundle.cjs` exists)

### PaaSPublishStrategy (PaaS Flow)

Encapsulates the simplified PaaS publish workflow:

```typescript
class PaaSPublishStrategy implements PublishStrategy {
  readonly key: DeploymentStrategy = "paas";

  async publish(context: PublishContext): Promise<PublishResult> {
    const { logger } = context;

    // No git operations - generate timestamp identifier
    const commitHash = `paas-${Date.now()}`;
    logger.info(`route.publish.${this.key}.git-skipped`, { commitHash });

    // Build
    logger.info(`route.publish.${this.key}.build.begin`, {});
    await this.build(context);

    // Create archive (force full source)
    const archivePath = await this.createArchive(context, commitHash);

    return { commitHash, archivePath };
  }

  // Private methods for internal workflow
  private async build(context): Promise<void> { ... }
  private async createArchive(context, commitHash): Promise<string> { ... }
}
```

**Internal workflow:**

1. Skip git operations, generate timestamp-based identifier
2. Run `NODE_ENV=production npm run build`
3. Create archive with `includeSource: true` (ensures `package.json` included)

### Route Handler (Orchestrator)

```typescript
// publish.ts - thin orchestrator

router.post(
  "/apps/:id/publish",
  requirePermission("canPublish"),
  async (req, res) => {
    const { id } = req.params;
    const { deploymentStrategy } = req.body;

    // Validate app exists
    const app = appRepository.findById(id);
    if (!app) return res.status(404).json({ error: "App not found" });

    // Get strategy (defaults to 'default' for backward compatibility)
    const strategy = getPublishStrategy(deploymentStrategy);
    logger.info("route.publish.strategy-selected", {
      strategy: strategy.key,
    });

    // Create context
    const context: PublishContext = {
      appId: id,
      appPath: app.path,
      outputDir,
      devSupervisor: DevSupervisorClientFactory.createForApp(id),
      gitUtils: new GitUtils(devSupervisor),
      logger: log.forApp(id),
    };

    // Execute strategy - single call, strategy owns workflow
    const { commitHash, archivePath } = await strategy.publish(context);

    // Call publish supervisor (same for both strategies)
    if (isUnifiedJob) {
      await publishSupervisor.publish({ commitHash, ... });
    }

    return res.json({
      success: true,
      commitHash,
      archive: { path: archivePath },
    });
  },
);
```

## Archive Strategy Details

### When `includeSource: false` (dist-only) - Default Strategy Auto-Detect

Archive only the `dist/` folder when `dist/server.bundle.cjs` exists:

```bash
tar -czf {archivePath} -C /app dist
```

**Contents:**

- `dist/` (bundled JavaScript, copied media, etc.)
- `airo-media.json` copied into `dist/` if exists

### When `includeSource: true` (full source) - PaaS Strategy

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

- `package.json` (required for npm install)
- `package-lock.json` / `pnpm-lock.yaml` / `bun.lockb` (lockfiles)
- `src/` (source code)
- `dist/` (build output)
- `.airo/` (custom config with serve command)
- `drizzle/` (database migrations)
- `public/` (static assets)
- `vite.config.*`, `tsconfig.json`, `postcss.config.*`, `tailwind.config.*`
- `index.html` (entry point)
- `airo-media.json` (media manifest, if exists)

**Contents excluded:**

- `node_modules/` (will be installed on deploy)
- `.git/` (version control data)
- `.env*` files (secrets - must not be in archive)

## Scenarios Handled

| Scenario              | Strategy  | Git Ops | Archive Type       | Production Behavior                 |
| --------------------- | --------- | ------- | ------------------ | ----------------------------------- |
| AAB v8 template       | `default` | Full    | dist/ only (auto)  | Fast path: runs `server.bundle.cjs` |
| AAB legacy            | `default` | Full    | Full source (auto) | Fallback: `build-and-run.sh`        |
| PaaS with bundling    | `paas`    | None    | Full source        | Fallback: `build-and-run.sh`        |
| PaaS without bundling | `paas`    | None    | Full source        | Fallback: `build-and-run.sh`        |
| Existing API calls    | `default` | Full    | Auto-detect        | No change (backward compatible)     |

## Error Handling

| Strategy | Error Scenario           | HTTP Status | Response                                 |
| -------- | ------------------------ | ----------- | ---------------------------------------- |
| Default  | Git merge fails          | 400         | "Failed to merge feature branch to main" |
| Default  | Commit not found         | 400         | "Failed to get current commit"           |
| Both     | Build fails              | 400         | "Build failed" + stderr                  |
| Both     | No dist/ folder          | 400         | "dist/ folder not found"                 |
| Both     | Supervisor unavailable   | 500         | "Dev supervisor not available"           |
| Both     | Publish supervisor fails | 500         | "Publish supervisor failed"              |

## Testing Strategy

### Unit Tests (`strategies/__tests__/`)

**DefaultPublishStrategy.test.ts:**

1. `key` returns "default"
2. `publish()` calls git operations (getCurrentBranch, getCurrentCommit)
3. `publish()` handles detached HEAD state
4. `publish()` handles feature branch merge (fast-forward vs squash)
5. `publish()` returns valid PublishResult with commitHash and archivePath
6. `publish()` uses auto-detect archive (no explicit includeSource)
7. Logs use correct prefix: `route.publish.default.*`

**PaaSPublishStrategy.test.ts:**

1. `key` returns "paas"
2. `publish()` does NOT call any gitUtils git methods
3. `publish()` returns timestamp-based commitHash (`paas-{timestamp}`)
4. `publish()` passes `includeSource: true` to createArchive
5. `publish()` returns valid PublishResult
6. Logs use correct prefix: `route.publish.paas.*`

**getPublishStrategy.test.ts:**

```typescript
it("returns DefaultPublishStrategy for undefined", () => {
  expect(getPublishStrategy(undefined).key).toBe("default");
});

it("returns DefaultPublishStrategy for null", () => {
  expect(getPublishStrategy(null).key).toBe("default");
});

it('returns DefaultPublishStrategy for "default"', () => {
  expect(getPublishStrategy("default").key).toBe("default");
});

it('returns PaaSPublishStrategy for "paas"', () => {
  expect(getPublishStrategy("paas").key).toBe("paas");
});

it("returns DefaultPublishStrategy for invalid values", () => {
  expect(getPublishStrategy("invalid").key).toBe("default");
});
```

### Integration Tests (`routes/__tests__/publish.integration.test.ts`)

**Backward Compatibility:**

```typescript
it("uses default strategy when no deploymentStrategy provided", async () => {
  const res = await request(app).post("/apps/test-id/publish").send({});
  // Verify git ops were called
});
```

**PaaS Flow:**

```typescript
it("skips git ops when deploymentStrategy is paas", async () => {
  const res = await request(app)
    .post("/apps/test-id/publish")
    .send({ deploymentStrategy: "paas" });
  // Verify NO git ops called
  // Verify includeSource: true in archive
});
```

### Manual Testing

```bash
# 1. Test default strategy (existing behavior)
curl -X POST http://localhost:4000/apps/{appId}/publish \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"

# 2. Test PaaS strategy
curl -X POST http://localhost:4000/apps/{appId}/publish \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"deploymentStrategy": "paas"}'

# 3. Verify archive contents for PaaS
tar -tzf /tmp/airo-app-builder/{appId}/dist/{hash}.tar.gz | grep package.json
# Should show: package.json
```

## Security Considerations

1. **Secrets exclusion** - `.env*` files explicitly excluded from full source archives
2. **node_modules exclusion** - Prevents potential malicious packages from being deployed
3. **No new attack surface** - Uses existing devSupervisor exec pattern
4. **Input validation** - Invalid `deploymentStrategy` values fall back to safe default

## Performance Impact

| Scenario           | Current                                     | Proposed                 | Impact                              |
| ------------------ | ------------------------------------------- | ------------------------ | ----------------------------------- |
| AAB apps (default) | Full git ops + dist-only                    | Same                     | No change                           |
| PaaS apps          | Full git ops (unnecessary) + broken archive | No git ops + full source | Faster (no git ops), larger archive |

## Migration & Rollback

**Migration:** No migration needed. Existing callers work unchanged.

**Rollback:** If issues arise:

1. Remove `deploymentStrategy` parameter handling
2. Revert to hardcoded default strategy
3. Or: Force specific strategy in code temporarily

## References

- [PR #1641](https://github.com/gdcorp-partners/airo-app-builder/pull/1641): Original dist-only archive optimization
- [publish-archive-strategy.md](../publish-archive-strategy.md): Archive strategy auto-detection design
- Production `build-and-run.sh`: Handles both fast path and fallback scenarios
- v8 template: Standard AAB template that produces `dist/server.bundle.cjs`

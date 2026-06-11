# Async Logo Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make logo generation non-blocking — the `generate_logo` tool kicks off a background job that returns immediately, shows an animated shimmer placeholder on the website preview + chat for the requested layouts, then updates the media slots / chat card / preview in place when the real logo is ready, with supersede, transient-retry, and UI cancel-with-revert.

**Architecture:** Mirror the existing async video pattern. A durable workspace file `.airo/logo.json` tracks job state (survives restarts + supersede). A detached `LogoGenerationService` worker runs the (retrying) upstream call, then writes the slots and pushes completion over WebSocket (`emitToApp`) + SSE. A new client `LogoHandler` reloads the preview slots and swaps the chat card in place. Logo is chat-tool-triggered (no REST endpoint); cancel is a `cancel_logo_generation` socket event mirroring `stop_generation`. AAB-only.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Express + Socket.IO (agents), Vitest, React + Zustand (app), dev-supervisor workspace API (`createForWorkspace(appId,'preview').files` → `view`/`write`/`stat`), `MediaManifestService`.

**Spec:** `docs/superpowers/specs/2026-06-09-async-logo-generation-design.md`

**Logging convention:** `logger.<level>("logo.<operation>.<lifecycle>", { camelCaseFields })`, always include `appId` + `jobId` when available (Grafana Loki filterable). See spec §8 for the full event table — add the listed events as each task is implemented.

---

## File map

**Agents (new):**
- `agents/src/services/logo/logo-job-state.ts` — `.airo/logo.json` types + read/write helpers
- `agents/src/services/logo/logo-shimmer.ts` — shimmer SVG asset + idempotent writer
- `agents/src/services/logo/logo-slots.ts` — `LOGO_SLOT_PATHS`, `saveLogoToSlots` (moved), `snapshotSlots`, `revertSlots`
- `agents/src/services/logo/LogoGenerationService.ts` — background worker + in-flight registry + cancel
- `app/src/hooks/shared/logoNotification.ts` — shared WS/SSE completion handler
- `app/src/hooks/websocket/handlers/LogoHandler.ts` — `type:'logo'` client handler

**Agents (modified):**
- `agents/src/services/LogoService.ts` — accept external `AbortSignal`
- `agents/src/services/MediaManifestService.ts` — add `pendingJobId` to `MediaSlot`, add `removeSlot`
- `agents/src/skills/media-logo/tools/index.ts` — async `generate_logo` kickoff; status-aware `set_venture_logo`; import moved slot helpers
- `agents/src/server/ai-lib-websocket-server.ts` — `cancel_logo_generation` socket handler; wire logo-status context message
- `agents/src/server/context-builders.ts` — `buildLogoStatusContextMessage`

**App (modified):**
- `app/src/services/websocket/TransportSupervisor.ts` + `app/src/hooks/websocket/handlers/index.ts` — register `LogoHandler`
- `app/src/services/websocket/StreamingWebSocketController.ts` — `cancelLogoGeneration()` emit
- `app/src/stores/useDevelopPageStore.ts` — logo completion store keyed by appId/jobId
- `app/src/app/[market]/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx` — started-ack placeholder + in-place swap + Cancel button

**Tests:** alongside each module; rewrite `generate-logo.test.ts` / `set-venture-logo.test.ts`; un-skip `tests/regression/develop-media.spec.ts` logo spec.

---

## Task 1: Durable job state (`.airo/logo.json`)

**Files:**
- Create: `agents/src/services/logo/logo-job-state.ts`
- Test: `agents/src/services/logo/__tests__/logo-job-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// agents/src/services/logo/__tests__/logo-job-state.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { DevSupervisorError } from '../../DevSupervisorClient.js'
import { readLogoJob, writeLogoJob, type LogoJob } from '../logo-job-state.js'

function makeJob(overrides: Partial<LogoJob> = {}): LogoJob {
  return {
    jobId: 'job-1', status: 'queued', prompt: 'p', layouts: ['horizontal'],
    slots: ['logo/horizontal'], isRegeneration: false, previousSlots: {},
    attempt: 0, createdAt: 'now', updatedAt: 'now', ...overrides,
  }
}

describe('logo-job-state', () => {
  let workspace: { view: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
  beforeEach(() => { workspace = { view: vi.fn(), write: vi.fn() } })

  it('readLogoJob parses the job file', async () => {
    workspace.view.mockResolvedValueOnce({ content: JSON.stringify(makeJob({ status: 'generating' })) })
    const job = await readLogoJob(workspace as never, 'app-1')
    expect(job?.status).toBe('generating')
  })

  it('readLogoJob returns null when the file is missing', async () => {
    workspace.view.mockRejectedValueOnce(new DevSupervisorError('not_found', 404, 'missing'))
    expect(await readLogoJob(workspace as never, 'app-1')).toBeNull()
  })

  it('readLogoJob rethrows non-not_found errors', async () => {
    workspace.view.mockRejectedValueOnce(new DevSupervisorError('internal', 500, 'boom'))
    await expect(readLogoJob(workspace as never, 'app-1')).rejects.toThrow('boom')
  })

  it('writeLogoJob serializes to .airo/logo.json', async () => {
    workspace.write.mockResolvedValueOnce(undefined)
    await writeLogoJob(workspace as never, 'app-1', makeJob())
    expect(workspace.write).toHaveBeenCalledWith({
      path: '.airo/logo.json',
      content: expect.stringContaining('"jobId": "job-1"'),
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit logo-job-state`
Expected: FAIL — `Cannot find module '../logo-job-state.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// agents/src/services/logo/logo-job-state.ts
import { logger } from '../../logging/index.js'
import { isDevSupervisorNotFound } from '../DevSupervisorClient.js'
import type { WorkspaceFiles } from '../../workspace/files.js'
import type { MediaSlot } from '../MediaManifestService.js'
import type { LogoLayout } from '../LogoService.js'

export const LOGO_JOB_PATH = '.airo/logo.json'

export type LogoJobStatus = 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled'

export interface LogoJob {
  jobId: string
  status: LogoJobStatus
  prompt: string
  layouts: LogoLayout[]
  /** Slot paths this job owns (derived from layouts, e.g. ['logo/horizontal']). */
  slots: string[]
  referenceUrl?: string
  /** True when any target slot already held a real logo (snapshot taken). */
  isRegeneration: boolean
  /** Full prior slot snapshot, keyed by slot path, for cancel/failure revert. */
  previousSlots: Record<string, MediaSlot>
  attempt: number
  sessionId?: string
  logoId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

/** Read .airo/logo.json. Returns null when no job file exists. Rethrows any
 *  non-not_found error so a supervisor outage isn't masked as "no job". */
export async function readLogoJob(workspace: WorkspaceFiles, appId: string): Promise<LogoJob | null> {
  try {
    const result = await workspace.view({ path: LOGO_JOB_PATH })
    return JSON.parse(result.content) as LogoJob
  } catch (err) {
    if (isDevSupervisorNotFound(err)) return null
    logger.warn('logo.metadata.read_error', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

export async function writeLogoJob(workspace: WorkspaceFiles, appId: string, job: LogoJob): Promise<void> {
  await workspace.write({ path: LOGO_JOB_PATH, content: JSON.stringify(job, null, 2) })
  logger.debug('logo.metadata.write', {
    appId, jobId: job.jobId, status: job.status, attempt: job.attempt,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit logo-job-state`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add agents/src/services/logo/logo-job-state.ts agents/src/services/logo/__tests__/logo-job-state.test.ts
git commit -m "feat(agents): add .airo/logo.json job-state helpers for async logo"
```

---

## Task 2: Shimmer placeholder asset

**Files:**
- Create: `agents/src/services/logo/logo-shimmer.ts`
- Test: `agents/src/services/logo/__tests__/logo-shimmer.test.ts`

The dev-supervisor resolver only serves slot URLs that are allowlisted-HTTPS or local files under `/airo-assets/uploads/*` (it 500s on empty/`data:`/inline SVG). So the shimmer is written to disk once and slots point at its URL.

- [ ] **Step 1: Write the failing test**

```ts
// agents/src/services/logo/__tests__/logo-shimmer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { ensureShimmerAsset, LOGO_SHIMMER_SLOT_URL } from '../logo-shimmer.js'

describe('ensureShimmerAsset', () => {
  let workspace: { stat: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
  beforeEach(() => { workspace = { stat: vi.fn(), write: vi.fn() } })

  it('writes the shimmer file when absent and returns its slot URL', async () => {
    workspace.stat.mockResolvedValueOnce({ entries: [{ path: 'p', error: 'not_found' }] })
    workspace.write.mockResolvedValueOnce(undefined)
    const url = await ensureShimmerAsset(workspace as never, 'app-1')
    expect(url).toBe(LOGO_SHIMMER_SLOT_URL)
    expect(workspace.write).toHaveBeenCalledTimes(1)
    expect(workspace.write.mock.calls[0][0].content).toContain('<svg')
  })

  it('does not rewrite when the file already exists', async () => {
    workspace.stat.mockResolvedValueOnce({ entries: [{ path: 'p', kind: 'file', size: 10, modifiedAt: 'now' }] })
    const url = await ensureShimmerAsset(workspace as never, 'app-1')
    expect(url).toBe(LOGO_SHIMMER_SLOT_URL)
    expect(workspace.write).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit logo-shimmer`
Expected: FAIL — `Cannot find module '../logo-shimmer.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// agents/src/services/logo/logo-shimmer.ts
import { logger } from '../../logging/index.js'
import type { WorkspaceFiles } from '../../workspace/files.js'

/** Slot currentUrl for the shimmer placeholder. Matches the dev-supervisor
 *  /airo-assets/uploads/* served-from-disk path (the only non-allowlisted
 *  form the resolver serves; empty/inline/data: URLs return HTTP 500). */
export const LOGO_SHIMMER_SLOT_URL = '/airo-assets/uploads/airo-logo-shimmer.svg'

/** Workspace-relative path the resolver searches for the basename above. */
const SHIMMER_WRITE_PATH = 'public/assets/uploads/airo-logo-shimmer.svg'

const SHIMMER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="Generating logo">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#e9edf2"/>
      <stop offset="50%" stop-color="#f6f8fa"/>
      <stop offset="100%" stop-color="#e9edf2"/>
      <animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1 0" dur="1.4s" repeatCount="indefinite"/>
    </linearGradient>
  </defs>
  <rect width="240" height="240" rx="16" fill="url(#g)"/>
</svg>`

/** Idempotently ensure the shared shimmer SVG exists on disk; returns the slot URL. */
export async function ensureShimmerAsset(workspace: WorkspaceFiles, appId: string): Promise<string> {
  try {
    const stat = await workspace.stat({ paths: [SHIMMER_WRITE_PATH] })
    const entry = stat.entries[0]
    if (entry && entry.error === undefined && entry.kind === 'file') {
      logger.debug('logo.shimmer.asset_exists', { appId, path: SHIMMER_WRITE_PATH })
      return LOGO_SHIMMER_SLOT_URL
    }
  } catch (err) {
    logger.warn('logo.shimmer.stat_error', {
      appId, error: err instanceof Error ? err.message : String(err),
    })
  }

  await workspace.write({ path: SHIMMER_WRITE_PATH, content: SHIMMER_SVG })
  logger.info('logo.shimmer.asset_written', { appId, path: SHIMMER_WRITE_PATH })
  return LOGO_SHIMMER_SLOT_URL
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit logo-shimmer`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add agents/src/services/logo/logo-shimmer.ts agents/src/services/logo/__tests__/logo-shimmer.test.ts
git commit -m "feat(agents): add idempotent shimmer placeholder asset writer"
```

---

## Task 3: `LogoService.generate()` honors an external AbortSignal

Enables prompt cancellation of the in-flight upstream call (combined with the existing 240s timeout).

**Files:**
- Modify: `agents/src/services/LogoService.ts` (`GenerateLogoInput` ~32-39, the `fetch` call ~171-184)
- Test: `agents/src/services/__tests__/LogoService.abort.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// agents/src/services/__tests__/LogoService.abort.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@airo/ai-lib', () => ({ getS2SToken: vi.fn(async () => 'test-token') }))

import { logoService } from '../LogoService.js'

describe('LogoService external AbortSignal', () => {
  const originalFetch = global.fetch
  beforeEach(() => { process.env.LOGO_API_URL = 'https://logo.test' })
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks() })

  it('aborts the upstream fetch when the external signal aborts', async () => {
    let capturedSignal: AbortSignal | undefined
    global.fetch = vi.fn((_url: string, opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal
      return new Promise(() => {}) // never resolves; the abort is what we assert
    }) as never

    const controller = new AbortController()
    const promise = logoService.generate({
      prompt: 'p', layout: ['square'], appId: 'app-1',
      customerId: 'cust-1', budgetUserId: 'user-1', signal: controller.signal,
    })
    promise.catch(() => {}) // swallow the eventual abort rejection

    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(capturedSignal?.aborted).toBe(false)
    controller.abort()
    expect(capturedSignal?.aborted).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit LogoService.abort`
Expected: FAIL — `generate` rejects/ignores the unknown `signal` field (TS error or `capturedSignal` undefined).

- [ ] **Step 3: Add `signal` to the input type**

In `agents/src/services/LogoService.ts`, add to `GenerateLogoInput`:

```ts
export interface GenerateLogoInput {
  prompt: string
  layout: LogoLayout[]
  referenceUrl?: string
  appId: string
  customerId: string
  budgetUserId: string
  /** Optional external cancellation signal (combined with the request timeout). */
  signal?: AbortSignal
}
```

- [ ] **Step 4: Combine the signal at the fetch call**

Replace the `fetch` call's `signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),` line with a combined signal built just before the `fetch`:

```ts
      const token = await getS2SToken()
      const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      const signal = input.signal
        ? AbortSignal.any([timeoutSignal, input.signal])
        : timeoutSignal
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'x-app-key': this.appKey,
          'x-app-builder-app-id': input.appId,
          'x-customer-id': input.customerId,
          'x-budget-user-id': input.budgetUserId,
        },
        body: JSON.stringify(body),
        signal,
      })
```

(The existing `catch` already maps `DOMException` `TimeoutError`/`AbortError` — no change needed there.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit LogoService.abort`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add agents/src/services/LogoService.ts agents/src/services/__tests__/LogoService.abort.test.ts
git commit -m "feat(agents): LogoService.generate honors an external AbortSignal"
```

---

## Task 4: `MediaSlot.pendingJobId` field + `MediaManifestService.removeSlot`

`removeSlot` deletes a manifest entry (needed to revert a *fresh* placeholder on cancel/failure — an empty `currentUrl` would 500, so the slot must be removed, not blanked). `pendingJobId` marks a slot as a placeholder/mid-regeneration.

**Files:**
- Modify: `agents/src/services/MediaManifestService.ts` (`MediaSlot` interface; add `removeSlot` near `setSlot`)
- Test: `agents/src/services/__tests__/MediaManifestService.removeSlot.test.ts`

- [ ] **Step 1: Add the `pendingJobId` field to `MediaSlot`**

In the `MediaSlot` interface add:

```ts
  /** Set while a background logo job is populating this slot (shimmer placeholder /
   *  mid-regeneration). Cleared on completion, cancel, or failure. */
  pendingJobId?: string;
```

- [ ] **Step 2: Write the failing test**

> Note: confirm `MediaManifestService` imports `appRepository` from `../database/repositories/index.js` and that the manifest filename is `airo-media.json` (adjust the mock path if the constructor injects the repo differently). If a `MediaManifestService.test.ts` already exists, add these cases to it using its harness instead.

```ts
// agents/src/services/__tests__/MediaManifestService.removeSlot.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
}))

vi.mock('node:fs/promises', () => ({
  readFile: h.readFile, writeFile: h.writeFile, rename: h.rename,
}))
vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../database/repositories/index.js', () => ({
  appRepository: { findById: vi.fn(() => ({ id: 'app-1', path: '/tmp/app' })) },
}))

import { mediaManifestService } from '../MediaManifestService.js'

const slot = (currentUrl: string, mediaType = 'logo') => ({
  mediaType, currentUrl, alternatives: [], userModified: false,
  searchQuery: '', createdAt: 'now', lastUpdated: 'now',
})

describe('MediaManifestService.removeSlot', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('removes the slot key and preserves others (skipGitCommit)', async () => {
    h.readFile.mockResolvedValue(JSON.stringify({
      'logo/horizontal': slot('x'),
      'pages/home/hero': slot('y', 'image'),
    }))

    const res = await mediaManifestService.removeSlot('app-1', 'logo/horizontal', true)

    expect(res.success).toBe(true)
    const written = JSON.parse(h.writeFile.mock.calls.at(-1)![1] as string)
    expect(written['logo/horizontal']).toBeUndefined()
    expect(written['pages/home/hero']).toBeDefined()
  })

  it('returns success:true and no write when the slot is already absent', async () => {
    h.readFile.mockResolvedValue(JSON.stringify({ 'pages/home/hero': slot('y', 'image') }))
    const res = await mediaManifestService.removeSlot('app-1', 'logo/horizontal', true)
    expect(res.success).toBe(true)
    expect(h.writeFile).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit MediaManifestService.removeSlot`
Expected: FAIL — `removeSlot is not a function`.

- [ ] **Step 4: Implement `removeSlot`** (model on the existing `setSlot`; place directly after it)

```ts
  async removeSlot(
    appId: string,
    slotName: string,
    skipGitCommit: boolean = false
  ): Promise<ManifestOperationResult> {
    const app = this.appRepository.findById(appId);
    if (!app) {
      return { success: false, error: `App not found: ${appId}` };
    }

    const logContext = { appId, slotName };
    logger.info('media_manifest.remove_slot.begin', logContext);

    const releaseLock = await acquireLock(appId);
    try {
      const manifestPath = this.getManifestPath(app.path);

      let manifest: MediaManifest = {};
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('media_manifest.remove_slot.read_error', {
            ...logContext,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        manifest = {};
      }

      if (!manifest[slotName]) {
        logger.info('media_manifest.remove_slot.absent', logContext);
        return { success: true, manifest };
      }

      delete manifest[slotName];
      await this.writeManifest(manifestPath, manifest);
      logger.info('media_manifest.remove_slot.written', logContext);

      let commitHash: string | undefined;
      if (!skipGitCommit) {
        try {
          commitHash = await this.commitManifestChange(appId, slotName, 'delete');
        } catch (gitError) {
          logger.warn('media_manifest.remove_slot.git_commit_failed', {
            ...logContext,
            error: gitError instanceof Error ? gitError.message : String(gitError),
          });
        }
      }

      logger.info('media_manifest.remove_slot.success', { ...logContext, commitHash });
      return { success: true, manifest, commitHash };
    } finally {
      releaseLock();
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit MediaManifestService.removeSlot`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add agents/src/services/MediaManifestService.ts agents/src/services/__tests__/MediaManifestService.removeSlot.test.ts
git commit -m "feat(agents): add MediaSlot.pendingJobId + MediaManifestService.removeSlot"
```

---

## Task 5: Extract `logo-slots.ts` (move `saveLogoToSlots` + add snapshot/shimmer/revert)

Moves the shared slot helpers out of the skill tool so the background worker can call them too (service must not import skill code). Adds snapshot/placeholder/revert used by the async + cancel flows. This is a pure relocation for `saveLogoToSlots` — keep its body byte-identical so existing behavior is unchanged.

**Files:**
- Create: `agents/src/services/logo/logo-slots.ts`
- Modify: `agents/src/skills/media-logo/tools/index.ts` (remove the moved defs, import them)
- Test: `agents/src/services/logo/__tests__/logo-slots.test.ts`

- [ ] **Step 1: Create `logo-slots.ts`**

Move `LOGO_SLOT_PATHS`, `ALL_LAYOUTS`, the `SaveSlotsResult` type, and `saveLogoToSlots` **verbatim** out of `agents/src/skills/media-logo/tools/index.ts`, then add the snapshot/placeholder/revert helpers. Result:

```ts
// agents/src/services/logo/logo-slots.ts
import { logger } from '../../logging/index.js'
import { mediaManifestService, type MediaSlot } from '../MediaManifestService.js'
import type { LogoLayout, LayoutUrls, LogoSessionResponse } from '../LogoService.js'
import { LOGO_SHIMMER_SLOT_URL } from './logo-shimmer.js'
import type { LogoJob } from './logo-job-state.js'

export const LOGO_SLOT_PATHS: Record<LogoLayout, string> = {
  square: 'logo/primary',
  horizontal: 'logo/horizontal',
  vertical: 'logo/vertical',
}

export const ALL_LAYOUTS: LogoLayout[] = ['square', 'horizontal', 'vertical']

export interface SaveSlotsResult {
  savedSlots: Partial<Record<LogoLayout, string>>
  slotSaveFailed: boolean
  failedLayouts: LogoLayout[]
}

// --- MOVED VERBATIM from skills/media-logo/tools/index.ts (do not alter logic) ---
export async function saveLogoToSlots(
  appId: string,
  response: LogoSessionResponse,
  searchQuery: string,
): Promise<SaveSlotsResult> {
  const savedSlots: Partial<Record<LogoLayout, string>> = {}
  const failedLayouts: LogoLayout[] = []
  const now = new Date().toISOString()

  for (const layout of ALL_LAYOUTS) {
    const variants: LayoutUrls | undefined = response.logo.urls[layout]
    if (!variants) continue

    const slotPath = LOGO_SLOT_PATHS[layout]
    const transparent = variants.transparent

    const solidUrlMap = { [transparent]: variants.solid }
    const reversedUrlMap = { [transparent]: variants.reversed }
    const reversedSolidUrlMap = { [transparent]: variants.reversedSolid }
    const mockupUrlMap = { [transparent]: variants.mockup }
    const landscapeMockupUrlMap = { [transparent]: variants.landscapeMockup }
    const logoSourceMap = {
      [transparent]: { sessionId: response.sessionId, logoId: response.logo.id },
    }

    let mergedAlternatives: string[] = []
    let mergedSolidUrlMap = { ...solidUrlMap }
    let mergedReversedUrlMap = { ...reversedUrlMap }
    let mergedReversedSolidUrlMap = { ...reversedSolidUrlMap }
    let mergedMockupUrlMap = { ...mockupUrlMap }
    let mergedLandscapeMockupUrlMap = { ...landscapeMockupUrlMap }
    let mergedLogoSourceMap = { ...logoSourceMap }
    let createdAt = now

    try {
      const existing = await mediaManifestService.getSlot(appId, slotPath)
      if (existing.success && existing.slot) {
        const old = existing.slot
        const oldUrls = [old.currentUrl, ...(old.alternatives ?? [])].filter(
          (u) => u && u !== transparent,
        )
        mergedAlternatives = oldUrls
        mergedSolidUrlMap = { ...(old.solidUrlMap ?? {}), ...solidUrlMap }
        mergedReversedUrlMap = { ...(old.reversedUrlMap ?? {}), ...reversedUrlMap }
        mergedReversedSolidUrlMap = { ...(old.reversedSolidUrlMap ?? {}), ...reversedSolidUrlMap }
        mergedMockupUrlMap = { ...(old.mockupUrlMap ?? {}), ...mockupUrlMap }
        mergedLandscapeMockupUrlMap = {
          ...(old.landscapeMockupUrlMap ?? {}),
          ...landscapeMockupUrlMap,
        }
        mergedLogoSourceMap = { ...(old.logoSourceMap ?? {}), ...logoSourceMap }
        createdAt = old.createdAt || now
      }

      await mediaManifestService.setSlot(appId, slotPath, {
        mediaType: 'logo',
        currentUrl: transparent,
        searchQuery,
        alternatives: mergedAlternatives,
        solidUrlMap: mergedSolidUrlMap,
        reversedUrlMap: mergedReversedUrlMap,
        reversedSolidUrlMap: mergedReversedSolidUrlMap,
        mockupUrlMap: mergedMockupUrlMap,
        landscapeMockupUrlMap: mergedLandscapeMockupUrlMap,
        logoSourceMap: mergedLogoSourceMap,
        userModified: false,
        createdAt,
        lastUpdated: now,
      })

      savedSlots[layout] = `/airo-assets/images/${slotPath}`
      logger.info('skill.media-logo.slot_saved', {
        appId, slotPath, layout, sessionId: response.sessionId,
      })
    } catch (err) {
      failedLayouts.push(layout)
      logger.error('skill.media-logo.slot_save_failed', {
        appId, slotPath, layout,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { savedSlots, slotSaveFailed: failedLayouts.length > 0, failedLayouts }
}
// --- END moved block ---

/** Snapshot the current real logos for the given slots (so cancel/failure can
 *  restore them). A shimmer placeholder or missing slot is NOT snapshotted. */
export async function snapshotSlots(
  appId: string,
  slotPaths: string[],
): Promise<{ previousSlots: Record<string, MediaSlot>; isRegeneration: boolean }> {
  const previousSlots: Record<string, MediaSlot> = {}
  for (const slotPath of slotPaths) {
    const result = await mediaManifestService.getSlot(appId, slotPath)
    const slot = result.success ? result.slot : undefined
    if (slot && slot.currentUrl && slot.currentUrl !== LOGO_SHIMMER_SLOT_URL && !slot.pendingJobId) {
      previousSlots[slotPath] = slot
      logger.debug('logo.slots.snapshot', { appId, slot: slotPath })
    }
  }
  return { previousSlots, isRegeneration: Object.keys(previousSlots).length > 0 }
}

/** Point each requested slot at the shimmer asset, tagged with the owning jobId. */
export async function placeShimmerSlots(
  appId: string,
  slotPaths: string[],
  jobId: string,
  shimmerUrl: string,
): Promise<void> {
  const now = new Date().toISOString()
  for (const slotPath of slotPaths) {
    await mediaManifestService.setSlot(appId, slotPath, {
      mediaType: 'logo',
      currentUrl: shimmerUrl,
      searchQuery: '',
      alternatives: [],
      userModified: false,
      pendingJobId: jobId,
      createdAt: now,
      lastUpdated: now,
    })
    logger.info('logo.slots.precreate', { appId, jobId, slot: slotPath })
  }
}

/** Revert this job's slots: restore the prior logo (regeneration) or remove the
 *  fresh placeholder. Skips slots a newer job has taken over (supersede-safe). */
export async function revertSlots(appId: string, job: LogoJob): Promise<void> {
  for (const slotPath of job.slots) {
    const current = await mediaManifestService.getSlot(appId, slotPath)
    if (current.success && current.slot?.pendingJobId && current.slot.pendingJobId !== job.jobId) {
      logger.info('logo.revert.skip_superseded', {
        appId, jobId: job.jobId, slot: slotPath, ownerJobId: current.slot.pendingJobId,
      })
      continue
    }
    const prior = job.previousSlots[slotPath]
    if (prior) {
      await mediaManifestService.setSlot(appId, slotPath, prior)
      logger.info('logo.revert.restore', { appId, jobId: job.jobId, slot: slotPath })
    } else {
      await mediaManifestService.removeSlot(appId, slotPath)
      logger.info('logo.revert.remove_placeholder', { appId, jobId: job.jobId, slot: slotPath })
    }
  }
}
```

- [ ] **Step 2: Update the skill tool to import the moved symbols**

In `agents/src/skills/media-logo/tools/index.ts`: delete the now-moved `LOGO_SLOT_PATHS`, `ALL_LAYOUTS`, `SaveSlotsResult`, and `saveLogoToSlots` definitions and add:

```ts
import { LOGO_SLOT_PATHS, saveLogoToSlots } from '../../../services/logo/logo-slots.js'
```

(If `index.ts` declared a `LogoSlotLayout` alias used elsewhere, keep it; `LOGO_SLOT_PATHS` is now typed `Record<LogoLayout, string>`. Run typecheck to surface any remaining references.)

- [ ] **Step 3: Write the new-helper test**

```ts
// agents/src/services/logo/__tests__/logo-slots.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetSlot = vi.fn()
const mockSetSlot = vi.fn(async () => ({ success: true }))
const mockRemoveSlot = vi.fn(async () => ({ success: true }))
vi.mock('../../MediaManifestService.js', () => ({
  mediaManifestService: { getSlot: mockGetSlot, setSlot: mockSetSlot, removeSlot: mockRemoveSlot },
}))
vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { snapshotSlots, placeShimmerSlots, revertSlots } from '../logo-slots.js'
import { LOGO_SHIMMER_SLOT_URL } from '../logo-shimmer.js'
import type { LogoJob } from '../logo-job-state.js'

const baseJob = (overrides: Partial<LogoJob> = {}): LogoJob => ({
  jobId: 'job-1', status: 'failed', prompt: 'p', layouts: ['horizontal'],
  slots: ['logo/horizontal'], isRegeneration: false, previousSlots: {},
  attempt: 0, createdAt: 'now', updatedAt: 'now', ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockSetSlot.mockResolvedValue({ success: true })
  mockRemoveSlot.mockResolvedValue({ success: true })
})

describe('snapshotSlots', () => {
  it('snapshots a real prior logo and flags regeneration', async () => {
    mockGetSlot.mockResolvedValue({ success: true, slot: { currentUrl: 'https://cdn/logo.png', mediaType: 'logo' } })
    const { previousSlots, isRegeneration } = await snapshotSlots('app-1', ['logo/horizontal'])
    expect(isRegeneration).toBe(true)
    expect(previousSlots['logo/horizontal']).toBeDefined()
  })

  it('ignores a shimmer placeholder (fresh)', async () => {
    mockGetSlot.mockResolvedValue({ success: true, slot: { currentUrl: LOGO_SHIMMER_SLOT_URL, pendingJobId: 'old' } })
    const { previousSlots, isRegeneration } = await snapshotSlots('app-1', ['logo/horizontal'])
    expect(isRegeneration).toBe(false)
    expect(previousSlots).toEqual({})
  })

  it('ignores a missing slot', async () => {
    mockGetSlot.mockResolvedValue({ success: false })
    expect((await snapshotSlots('app-1', ['logo/horizontal'])).isRegeneration).toBe(false)
  })
})

describe('placeShimmerSlots', () => {
  it('sets each slot to the shimmer URL with the pendingJobId marker', async () => {
    await placeShimmerSlots('app-1', ['logo/primary', 'logo/horizontal'], 'job-9', LOGO_SHIMMER_SLOT_URL)
    expect(mockSetSlot).toHaveBeenCalledTimes(2)
    const [, slotPath, slot] = mockSetSlot.mock.calls[0]
    expect(slotPath).toBe('logo/primary')
    expect(slot).toMatchObject({ currentUrl: LOGO_SHIMMER_SLOT_URL, pendingJobId: 'job-9', mediaType: 'logo' })
  })
})

describe('revertSlots', () => {
  it('restores the prior slot for a regeneration', async () => {
    const prior = { currentUrl: 'https://cdn/old.png', mediaType: 'logo', alternatives: [], userModified: false, searchQuery: '', createdAt: 'now', lastUpdated: 'now' }
    mockGetSlot.mockResolvedValue({ success: true, slot: { pendingJobId: 'job-1', currentUrl: LOGO_SHIMMER_SLOT_URL } })
    await revertSlots('app-1', baseJob({ isRegeneration: true, previousSlots: { 'logo/horizontal': prior as never } }))
    expect(mockSetSlot).toHaveBeenCalledWith('app-1', 'logo/horizontal', prior)
    expect(mockRemoveSlot).not.toHaveBeenCalled()
  })

  it('removes a fresh placeholder when there is no prior slot', async () => {
    mockGetSlot.mockResolvedValue({ success: true, slot: { pendingJobId: 'job-1', currentUrl: LOGO_SHIMMER_SLOT_URL } })
    await revertSlots('app-1', baseJob())
    expect(mockRemoveSlot).toHaveBeenCalledWith('app-1', 'logo/horizontal')
  })

  it('skips a slot taken over by a newer job', async () => {
    mockGetSlot.mockResolvedValue({ success: true, slot: { pendingJobId: 'job-NEWER', currentUrl: LOGO_SHIMMER_SLOT_URL } })
    await revertSlots('app-1', baseJob())
    expect(mockRemoveSlot).not.toHaveBeenCalled()
    expect(mockSetSlot).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @airo/agents test:unit logo-slots`
Expected: PASS.
Run: `pnpm --filter @airo/agents test:unit generate-logo` and `... set-venture-logo`
Expected: still PASS (move is behavior-preserving).
Run: `pnpm --filter @airo/agents typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add agents/src/services/logo/logo-slots.ts agents/src/services/logo/__tests__/logo-slots.test.ts agents/src/skills/media-logo/tools/index.ts
git commit -m "refactor(agents): extract logo-slots helpers + add snapshot/shimmer/revert"
```

---

## Task 6: `LogoGenerationService` — background worker, registry, cancel, emit

The heart of the feature. Owns: kickoff (shimmer + snapshot + job file + supersede), the detached retrying run, the supersede guard, completion/failure/cancel state + revert, and the dual WS+SSE emit. (Large task — during execution it can be split into 6a kickoff+happy, 6b retry/failure, 6c cancel/supersede; keep them in one commit since the tests are shared.)

**Files:**
- Create: `agents/src/services/logo/LogoGenerationService.ts`
- Test: `agents/src/services/logo/__tests__/LogoGenerationService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// agents/src/services/logo/__tests__/LogoGenerationService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LogoJob } from '../logo-job-state.js'

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

class FakeBudgetError extends Error {
  static isInstance(e: unknown): e is FakeBudgetError { return e instanceof FakeBudgetError }
}
vi.mock('@airo/ai-common', () => ({ BudgetExceededError: FakeBudgetError }))

const mockGenerate = vi.fn()
vi.mock('../../LogoService.js', () => ({ logoService: { generate: mockGenerate } }))

const mockEmitToApp = vi.fn(() => 1)
vi.mock('../../../server/ai-lib-websocket-server.js', () => ({ emitToApp: mockEmitToApp }))

const mockSendToApp = vi.fn()
vi.mock('../../../server/sse/registry-singleton.js', () => ({
  getSSERegistry: () => ({ sendToApp: mockSendToApp }),
}))

const fakeWorkspace = {}
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: () => ({ files: fakeWorkspace }),
}))

let lastJob: LogoJob | null = null
const mockReadLogoJob = vi.fn(async () => lastJob)
const mockWriteLogoJob = vi.fn(async (_ws: unknown, _appId: string, job: LogoJob) => { lastJob = job })
vi.mock('../logo-job-state.js', () => ({
  readLogoJob: (...a: unknown[]) => mockReadLogoJob(...(a as [])),
  writeLogoJob: (...a: unknown[]) => mockWriteLogoJob(...(a as [never, never, never])),
}))

const mockEnsureShimmer = vi.fn(async () => '/airo-assets/uploads/airo-logo-shimmer.svg')
vi.mock('../logo-shimmer.js', () => ({
  ensureShimmerAsset: mockEnsureShimmer,
  LOGO_SHIMMER_SLOT_URL: '/airo-assets/uploads/airo-logo-shimmer.svg',
}))

const mockSnapshot = vi.fn(async () => ({ previousSlots: {}, isRegeneration: false }))
const mockPlaceShimmer = vi.fn(async () => {})
const mockRevert = vi.fn(async () => {})
const mockSaveSlots = vi.fn(async () => ({ savedSlots: { horizontal: '/airo-assets/images/logo/horizontal' }, slotSaveFailed: false, failedLayouts: [] }))
vi.mock('../logo-slots.js', () => ({
  LOGO_SLOT_PATHS: { square: 'logo/primary', horizontal: 'logo/horizontal', vertical: 'logo/vertical' },
  saveLogoToSlots: mockSaveSlots,
  snapshotSlots: mockSnapshot,
  placeShimmerSlots: mockPlaceShimmer,
  revertSlots: mockRevert,
}))

import { logoGenerationService } from '../LogoGenerationService.js'

const okResponse = { sessionId: 's', logo: { id: 'l', generatedAt: 'now', prompt: 'p', modelUsed: 'm', urls: { horizontal: {} } } }
const baseParams = { appId: 'app-1', prompt: 'p', layouts: ['horizontal'] as const, customerId: 'c', budgetUserId: 'u', searchQuery: 'q' }
const abortable = () => mockGenerate.mockImplementation(({ signal }: { signal?: AbortSignal }) =>
  new Promise((_res, rej) => signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))))

beforeEach(() => {
  vi.clearAllMocks(); lastJob = null
  mockEmitToApp.mockReturnValue(1)
  mockSnapshot.mockResolvedValue({ previousSlots: {}, isRegeneration: false })
  mockSaveSlots.mockResolvedValue({ savedSlots: { horizontal: '/airo-assets/images/logo/horizontal' }, slotSaveFailed: false, failedLayouts: [] })
})

describe('LogoGenerationService.start (happy path)', () => {
  it('places shimmer, returns queued, then saves slots + emits completed', async () => {
    mockGenerate.mockResolvedValue(okResponse)
    const res = await logoGenerationService.start({ ...baseParams, layouts: ['horizontal'] })
    expect(res.status).toBe('queued')
    expect(mockPlaceShimmer).toHaveBeenCalledWith('app-1', ['logo/horizontal'], res.jobId, expect.any(String))
    expect(lastJob?.status).toBe('queued')

    await res.done
    expect(mockSaveSlots).toHaveBeenCalledTimes(1)
    expect(lastJob?.status).toBe('completed')
    expect(mockEmitToApp).toHaveBeenCalledWith('app-1', 'message',
      expect.objectContaining({ type: 'logo', data: expect.objectContaining({ status: 'completed', jobId: res.jobId }) }))
    expect(mockSendToApp).toHaveBeenCalledWith('app-1', 'logo', expect.objectContaining({ status: 'completed' }))
  })
})

describe('LogoGenerationService failure handling', () => {
  it('does not retry a budget error; reverts and emits failed', async () => {
    mockGenerate.mockRejectedValue(new FakeBudgetError('budget'))
    const res = await logoGenerationService.start(baseParams)
    await res.done
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockRevert).toHaveBeenCalledTimes(1)
    expect(lastJob?.status).toBe('failed')
    expect(mockEmitToApp).toHaveBeenCalledWith('app-1', 'message',
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed', errorKind: 'budget' }) }))
  })

  it('retries a transient error then succeeds (~1s backoff)', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('network boom')).mockResolvedValueOnce(okResponse)
    const res = await logoGenerationService.start(baseParams)
    await res.done
    expect(mockGenerate).toHaveBeenCalledTimes(2)
    expect(mockSaveSlots).toHaveBeenCalledTimes(1)
    expect(lastJob?.status).toBe('completed')
  })
})

describe('LogoGenerationService.cancel', () => {
  it('aborts the in-flight job, reverts, and emits cancelled', async () => {
    abortable()
    const res = await logoGenerationService.start(baseParams)
    await Promise.all([logoGenerationService.cancel('app-1', res.jobId), res.done])
    expect(mockRevert).toHaveBeenCalledTimes(1)
    expect(lastJob?.status).toBe('cancelled')
    expect(mockEmitToApp).toHaveBeenCalledWith('app-1', 'message',
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled', jobId: res.jobId }) }))
  })

  it('is a no-op when no job is in flight', async () => {
    const out = await logoGenerationService.cancel('app-1', 'nope')
    expect(out.cancelled).toBe(false)
    expect(mockRevert).not.toHaveBeenCalled()
  })
})

describe('LogoGenerationService supersede', () => {
  it('drops the superseded job and lets the newer one complete', async () => {
    abortable() // first job hangs until aborted
    const first = await logoGenerationService.start(baseParams)
    mockGenerate.mockResolvedValueOnce(okResponse) // second job succeeds
    const second = await logoGenerationService.start(baseParams)
    await Promise.allSettled([first.done, second.done])

    expect(lastJob?.jobId).toBe(second.jobId)
    expect(lastJob?.status).toBe('completed')
    expect(mockRevert).not.toHaveBeenCalled() // supersede does not revert
    expect(mockSaveSlots).toHaveBeenCalledTimes(1) // only the winner saves
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit LogoGenerationService`
Expected: FAIL — `Cannot find module '../LogoGenerationService.js'`.

- [ ] **Step 3: Implement the service**

```ts
// agents/src/services/logo/LogoGenerationService.ts
import { randomUUID } from 'node:crypto'
import { BudgetExceededError } from '@airo/ai-common'

import { logger } from '../../logging/index.js'
import { emitToApp } from '../../server/ai-lib-websocket-server.js'
import { getSSERegistry } from '../../server/sse/registry-singleton.js'
import { createForWorkspace } from '../../workspace/index.js'
import type { WorkspaceFiles } from '../../workspace/files.js'
import { logoService, type LogoLayout, type LogoSessionResponse } from '../LogoService.js'
import { readLogoJob, writeLogoJob, type LogoJob } from './logo-job-state.js'
import { ensureShimmerAsset } from './logo-shimmer.js'
import { LOGO_SLOT_PATHS, saveLogoToSlots, snapshotSlots, placeShimmerSlots, revertSlots } from './logo-slots.js'

export interface StartLogoParams {
  appId: string
  prompt: string
  layouts: LogoLayout[]
  referenceUrl?: string
  customerId: string
  budgetUserId: string
  searchQuery: string
}

export interface StartLogoResult {
  status: 'queued' | 'error'
  jobId?: string
  slots?: string[]
  error?: string
  /** Resolves when the background run settles. The tool ignores it; tests await it. */
  done?: Promise<void>
}

const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [1000, 3000]

type RunContext = StartLogoParams & {
  jobId: string
  slots: string[]
  controller: AbortController
  workspace: WorkspaceFiles
}

class LogoGenerationService {
  private readonly inFlight = new Map<string, { jobId: string; controller: AbortController }>()

  async start(params: StartLogoParams): Promise<StartLogoResult> {
    const { appId, layouts } = params
    const workspace = createForWorkspace(appId, 'preview')?.files ?? null
    if (!workspace) {
      logger.error('logo.async.no_workspace', { appId })
      return { status: 'error', error: 'Workspace unavailable for logo generation' }
    }

    const slots = layouts.map((l) => LOGO_SLOT_PATHS[l])
    const jobId = randomUUID()

    const existing = this.inFlight.get(appId)
    if (existing) {
      logger.warn('logo.async.superseded_previous', { appId, previousJobId: existing.jobId, newJobId: jobId })
      existing.controller.abort('superseded')
    }

    const shimmerUrl = await ensureShimmerAsset(workspace, appId)
    const { previousSlots, isRegeneration } = await snapshotSlots(appId, slots)
    await placeShimmerSlots(appId, slots, jobId, shimmerUrl)

    const now = new Date().toISOString()
    const job: LogoJob = {
      jobId,
      status: 'queued',
      prompt: params.prompt,
      layouts,
      slots,
      ...(params.referenceUrl ? { referenceUrl: params.referenceUrl } : {}),
      isRegeneration,
      previousSlots,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    }
    await writeLogoJob(workspace, appId, job)

    const controller = new AbortController()
    this.inFlight.set(appId, { jobId, controller })
    logger.info('logo.async.kickoff', {
      appId, jobId, layouts, slots, hasReference: !!params.referenceUrl, isRegeneration,
    })

    const done = this.run({ ...params, jobId, slots, controller, workspace }).catch((err) => {
      logger.error('logo.worker.unhandled', {
        appId, jobId, error: err instanceof Error ? err.message : String(err),
      })
    })

    return { status: 'queued', jobId, slots, done }
  }

  async cancel(appId: string, jobId?: string): Promise<{ cancelled: boolean }> {
    const entry = this.inFlight.get(appId)
    if (!entry || (jobId && entry.jobId !== jobId)) {
      logger.warn('logo.cancel.not_found', { appId, jobId })
      return { cancelled: false }
    }
    logger.info('logo.cancel.received', { appId, jobId: entry.jobId })
    entry.controller.abort('cancelled')
    this.inFlight.delete(appId)

    const workspace = createForWorkspace(appId, 'preview')?.files ?? null
    if (workspace) {
      const job = await readLogoJob(workspace, appId)
      if (job && job.jobId === entry.jobId) {
        await revertSlots(appId, job)
        await writeLogoJob(workspace, appId, { ...job, status: 'cancelled', updatedAt: new Date().toISOString() })
        this.emitLogoEvent(appId, { status: 'cancelled', jobId: entry.jobId, slots: job.slots })
      }
    }
    logger.info('logo.cancel.complete', { appId, jobId: entry.jobId })
    return { cancelled: true }
  }

  private async run(ctx: RunContext): Promise<void> {
    const { appId, jobId, slots, controller, workspace } = ctx
    const startedAt = Date.now()

    const job = await readLogoJob(workspace, appId)
    if (!job || job.jobId !== jobId) {
      logger.warn('logo.worker.superseded_drop', { appId, jobId, currentJobId: job?.jobId })
      return
    }
    await writeLogoJob(workspace, appId, { ...job, status: 'generating', updatedAt: new Date().toISOString() })
    logger.info('logo.worker.begin', { appId, jobId, attempt: 0 })

    let response: LogoSessionResponse | undefined
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (controller.signal.aborted) {
        logger.info('logo.worker.aborted', { appId, jobId })
        return // cancel()/start() owns revert
      }
      try {
        response = await logoService.generate({
          prompt: ctx.prompt,
          layout: ctx.layouts,
          ...(ctx.referenceUrl ? { referenceUrl: ctx.referenceUrl } : {}),
          appId,
          customerId: ctx.customerId,
          budgetUserId: ctx.budgetUserId,
          signal: controller.signal,
        })
        break
      } catch (err) {
        if (controller.signal.aborted) {
          logger.info('logo.worker.aborted', { appId, jobId })
          return
        }
        if (this.isHardError(err) || attempt >= MAX_ATTEMPTS) {
          await this.fail(appId, jobId, workspace, attempt, err)
          return
        }
        const delayMs = RETRY_BACKOFF_MS[attempt - 1] ?? 3000
        logger.warn('logo.worker.retry', {
          appId, jobId, attempt, delayMs, reason: err instanceof Error ? err.message : String(err),
        })
        await writeLogoJob(workspace, appId, { ...job, status: 'generating', attempt, updatedAt: new Date().toISOString() })
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
    if (!response) return // defensive — fail() already ran

    // Supersede guard: a newer job may have taken over while we awaited.
    const current = await readLogoJob(workspace, appId)
    if (!current || current.jobId !== jobId || controller.signal.aborted) {
      logger.warn('logo.worker.superseded_drop', { appId, jobId, currentJobId: current?.jobId })
      return
    }

    const { savedSlots, slotSaveFailed, failedLayouts } = await saveLogoToSlots(appId, response, ctx.searchQuery)
    logger.info('logo.worker.slots_saved', {
      appId, jobId, slots, savedSlots: Object.keys(savedSlots), droppedLayouts: failedLayouts,
    })

    await writeLogoJob(workspace, appId, {
      ...current,
      status: 'completed',
      sessionId: response.sessionId,
      logoId: response.logo.id,
      updatedAt: new Date().toISOString(),
    })
    if (this.inFlight.get(appId)?.jobId === jobId) this.inFlight.delete(appId)

    this.emitLogoEvent(appId, { status: 'completed', jobId, slots, slotSaveFailed })
    logger.info('logo.worker.complete', {
      appId, jobId, sessionId: response.sessionId, logoId: response.logo.id, durationMs: Date.now() - startedAt,
    })
  }

  private async fail(appId: string, jobId: string, workspace: WorkspaceFiles, attempt: number, err: unknown): Promise<void> {
    const errorKind = BudgetExceededError.isInstance(err) ? 'budget' : 'error'
    const message = err instanceof Error ? err.message : String(err)
    logger.error('logo.worker.failed', { appId, jobId, attempt, errorKind, error: message })

    const job = await readLogoJob(workspace, appId)
    if (job && job.jobId === jobId) {
      await revertSlots(appId, job)
      await writeLogoJob(workspace, appId, { ...job, status: 'failed', error: message, updatedAt: new Date().toISOString() })
      this.emitLogoEvent(appId, { status: 'failed', jobId, slots: job.slots, error: message, errorKind })
    }
    if (this.inFlight.get(appId)?.jobId === jobId) this.inFlight.delete(appId)
  }

  /** 402 budget + other 4xx are non-retryable; timeouts/5xx/network retry. */
  private isHardError(err: unknown): boolean {
    if (BudgetExceededError.isInstance(err)) return true
    const message = err instanceof Error ? err.message : String(err)
    return /status 4\d\d/.test(message)
  }

  private emitLogoEvent(appId: string, data: Record<string, unknown>): void {
    const eventData = { ...data, appId }
    const wsDelivered = emitToApp(appId, 'message', { type: 'logo', content: '', data: eventData })
    logger.info('logo.emit.ws', { appId, status: data.status, jobId: data.jobId, wsDelivered })
    const sse = getSSERegistry()
    if (sse) {
      sse.sendToApp(appId, 'logo', eventData)
      logger.debug('logo.emit.sse', { appId, status: data.status, jobId: data.jobId })
    } else if (wsDelivered === 0) {
      logger.warn('logo.emit.no_targets', { appId, status: data.status, jobId: data.jobId })
    }
  }
}

export const logoGenerationService = new LogoGenerationService()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit LogoGenerationService`
Expected: PASS (all describe blocks; the retry test takes ~1s).

- [ ] **Step 5: Commit**

```bash
git add agents/src/services/logo/LogoGenerationService.ts agents/src/services/logo/__tests__/LogoGenerationService.test.ts
git commit -m "feat(agents): LogoGenerationService background worker (retry/supersede/cancel/emit)"
```

---

## Task 7: Refactor `generate_logo` to async kickoff

Keep all input resolution (customer, grants/budgetUserId, palette suffix, layout expansion, reference auto-resolution) — only the tail changes: instead of awaiting `logoService.generate()` + `saveLogoToSlots()`, hand off to `logoGenerationService.start()` and return a `started` ack.

**Files:**
- Modify: `agents/src/skills/media-logo/tools/index.ts` (`generateLogoTool.execute`, imports, drop `config.timeout`, remove now-unused `buildResultText`)
- Test: `agents/src/skills/media-logo/tools/__tests__/generate-logo.test.ts` (rewrite the async contract)

- [ ] **Step 1: Add the import**

```ts
import { logoGenerationService } from '../../../services/logo/LogoGenerationService.js'
```

- [ ] **Step 2: Rewrite the affected tests**

Add the service mock near the other `vi.mock` calls, then replace the `slot save` and `output shape` describe blocks (the synchronous shape is gone — slot writing is now covered by `LogoGenerationService.test.ts`). Keep the existing customer/grants/palette/reference setup and tests.

```ts
// near the top, with the other vi.mock(...) calls:
const mockStart = vi.fn(async () => ({
  status: 'queued', jobId: 'job-1', slots: ['logo/horizontal'], done: Promise.resolve(),
}))
vi.mock('../../../../services/logo/LogoGenerationService.js', () => ({
  logoGenerationService: { start: mockStart },
}))

// replaces the old 'slot save' + 'output shape' describe blocks:
describe('async kickoff', () => {
  beforeEach(() => {
    mockStart.mockResolvedValue({ status: 'queued', jobId: 'job-1', slots: ['logo/horizontal'], done: Promise.resolve() })
  })

  it('returns a started ack (does not block on generation)', async () => {
    const { generateLogoTool } = await import('../index.js')
    const result = await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext)
    expect(result.structuredContent).toMatchObject({
      started: true, jobId: 'job-1', slots: ['logo/horizontal'], status: 'queued',
    })
    expect(result.text).toBeTruthy()
  })

  it('starts the job with the resolved prompt, layouts, customer and budget user', async () => {
    const { generateLogoTool } = await import('../index.js')
    await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext)
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-1',
      layouts: ['horizontal'],
      customerId: expect.any(String),
      budgetUserId: expect.any(String),
      searchQuery: expect.any(String),
    }))
  })

  it('surfaces a start error', async () => {
    mockStart.mockResolvedValueOnce({ status: 'error', error: 'Workspace unavailable for logo generation' })
    const { generateLogoTool } = await import('../index.js')
    const result = await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext)
    expect(result.error).toBe('Workspace unavailable for logo generation')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit generate-logo`
Expected: FAIL — `execute` still returns the old sync `structuredContent` / `logoGenerationService` undefined.

- [ ] **Step 4: Replace the tail of `execute()`**

Replace everything from `let response: LogoSessionResponse` through the `return { ... }` (the `logoService.generate` call, `saveLogoToSlots`, `producedLayouts`/`primaryLayout` block, and `buildResultText`) with:

```ts
    const result = await logoGenerationService.start({
      appId,
      prompt: finalPrompt,
      layouts,
      ...(referenceUrl !== undefined ? { referenceUrl } : {}),
      customerId,
      budgetUserId,
      searchQuery: input.prompt.slice(0, 80),
    })

    if (result.status === 'error') {
      return { error: result.error ?? 'Logo generation could not be started' }
    }

    logger.info('skill.media-logo.generate_logo.queued', {
      appId, jobId: result.jobId, slots: result.slots,
    })

    return {
      text:
        'Logo generation has started in the background. Placeholder slots are in place — ' +
        'you can reference the logo slots now and they will update automatically when the logo is ready. ' +
        'I will let you know when it completes (or if it fails).',
      structuredContent: {
        started: true,
        jobId: result.jobId,
        slots: result.slots,
        status: 'queued',
      },
    }
```

Then: delete the `config: { timeout: 240_000 }` block, and remove the now-unused `buildResultText` function and any imports that are no longer referenced (`saveLogoToSlots` is already moved; drop `LayoutUrls`/`LogoSessionResponse` type imports if unused). Run `pnpm --filter @airo/agents lint:fix` to surface unused symbols.

- [ ] **Step 5: Run tests + lint to verify they pass**

Run: `pnpm --filter @airo/agents test:unit generate-logo`
Expected: PASS.
Run: `pnpm --filter @airo/agents lint` and `pnpm --filter @airo/agents typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add agents/src/skills/media-logo/tools/index.ts agents/src/skills/media-logo/tools/__tests__/generate-logo.test.ts
git commit -m "feat(agents): generate_logo kicks off async background job + returns started ack"
```

---

## Task 8: Make `set_venture_logo` status-aware

If a logo job is still in flight, return a `pending` status instead of pushing shimmer URLs to the Venture dashboard.

**Files:**
- Modify: `agents/src/skills/media-logo/tools/index.ts` (`setVentureLogoTool.execute`)
- Test: `agents/src/skills/media-logo/tools/__tests__/set-venture-logo.test.ts`

- [ ] **Step 1: Write the failing test**

Add mocks for the workspace + job-state, then a pending-path test (keep the existing ready-path tests unchanged):

```ts
// with the other vi.mock(...) calls:
const mockReadLogoJob = vi.fn(async () => null)
vi.mock('../../../../services/logo/logo-job-state.js', () => ({
  readLogoJob: (...a: unknown[]) => mockReadLogoJob(),
}))
vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: () => ({ files: {} }),
}))

describe('set_venture_logo while a job is in flight', () => {
  it('returns pending without reading slots', async () => {
    mockReadLogoJob.mockResolvedValueOnce({ jobId: 'job-1', status: 'generating' })
    const { setVentureLogoTool } = await import('../index.js')
    const result = await setVentureLogoTool.execute({}, baseContext)
    expect(result.structuredContent).toEqual({ pending: true })
    expect(mockGetSlot).not.toHaveBeenCalled()
  })
})
```

(Ensure the default `mockReadLogoJob` returns `null` in `beforeEach` so the existing ready-path tests still read slots.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit set-venture-logo`
Expected: FAIL — current `execute` always reads slots.

- [ ] **Step 3: Add the in-flight guard at the top of `setVentureLogoTool.execute`**

After the `appId` guard, before the slot lookups:

```ts
    const workspace = createForWorkspace(appId, 'preview')?.files ?? null
    if (workspace) {
      const job = await readLogoJob(workspace, appId)
      if (job && (job.status === 'queued' || job.status === 'generating')) {
        logger.info('skill.media-logo.set_venture_logo.pending', { appId, jobId: job.jobId })
        return {
          text: 'The logo is still generating — I will set it on the venture dashboard once it is ready.',
          structuredContent: { pending: true },
        }
      }
    }
```

Add imports:

```ts
import { createForWorkspace } from '../../../workspace/index.js'
import { readLogoJob } from '../../../services/logo/logo-job-state.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit set-venture-logo`
Expected: PASS (pending + existing ready-path tests).

- [ ] **Step 5: Commit**

```bash
git add agents/src/skills/media-logo/tools/index.ts agents/src/skills/media-logo/tools/__tests__/set-venture-logo.test.ts
git commit -m "feat(agents): set_venture_logo defers while a logo job is in flight"
```

---

## Task 9: `cancel_logo_generation` socket handler

Mirrors `stop_generation`. The handler is a small exported function (testable), registered on each socket in the agents WS server. `appId` is taken from the authenticated `siteId` (never from client data), so cancel can only ever affect the socket's own app — no cross-tenant risk.

**Files:**
- Create: `agents/src/server/logo-cancel-handler.ts`
- Modify: `agents/src/server/ai-lib-websocket-server.ts` (register on socket)
- Test: `agents/src/server/__tests__/logo-cancel-handler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// agents/src/server/__tests__/logo-cancel-handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
const mockCancel = vi.fn(async () => ({ cancelled: true }))
vi.mock('../../services/logo/LogoGenerationService.js', () => ({
  logoGenerationService: { cancel: mockCancel },
}))

import { handleCancelLogoGeneration } from '../logo-cancel-handler.js'

const socketWith = (siteId?: string) => ({ id: 'sock-1', handshake: { auth: { agentContext: { siteId } } } })

beforeEach(() => { vi.clearAllMocks(); mockCancel.mockResolvedValue({ cancelled: true }) })

describe('handleCancelLogoGeneration', () => {
  it('cancels the authenticated app job and acks', async () => {
    const ack = vi.fn()
    await handleCancelLogoGeneration(socketWith('app-1'), { jobId: 'job-1' }, ack)
    expect(mockCancel).toHaveBeenCalledWith('app-1', 'job-1')
    expect(ack).toHaveBeenCalledWith({ success: true, cancelled: true })
  })

  it('acks an error when the socket has no authenticated siteId', async () => {
    const ack = vi.fn()
    await handleCancelLogoGeneration(socketWith(undefined), { jobId: 'job-1' }, ack)
    expect(mockCancel).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledWith({ error: 'Authentication context missing' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit logo-cancel-handler`
Expected: FAIL — `Cannot find module '../logo-cancel-handler.js'`.

- [ ] **Step 3: Implement the handler**

```ts
// agents/src/server/logo-cancel-handler.ts
import { logger } from '../logging/index.js'
import { logoGenerationService } from '../services/logo/LogoGenerationService.js'

interface CancelSocket {
  id: string
  handshake: { auth?: { agentContext?: { siteId?: string } } }
}
type CancelAck = (response: { success?: boolean; cancelled?: boolean; error?: string }) => void

export async function handleCancelLogoGeneration(
  socket: CancelSocket,
  data: { jobId?: string } | undefined,
  ack?: CancelAck,
): Promise<void> {
  const appId = socket.handshake.auth?.agentContext?.siteId
  if (!appId) {
    logger.error('logo.cancel.no_app', { socketId: socket.id })
    ack?.({ error: 'Authentication context missing' })
    return
  }
  try {
    const result = await logoGenerationService.cancel(appId, data?.jobId)
    ack?.({ success: true, cancelled: result.cancelled })
  } catch (err) {
    logger.error('logo.cancel.handler_error', {
      appId, error: err instanceof Error ? err.message : String(err),
    })
    ack?.({ error: 'Failed to cancel logo generation' })
  }
}
```

- [ ] **Step 4: Register on the socket**

In `agents/src/server/ai-lib-websocket-server.ts`, find the per-socket setup (where `addTenantValidationMiddleware(socket)` is called / the connection hook that also wires `stop_generation` in the base class). Add the import and the registration:

```ts
import { handleCancelLogoGeneration } from './logo-cancel-handler.js'

// within the per-socket connection setup:
socket.on(
  'cancel_logo_generation',
  (data: { jobId?: string }, ack?: (r: { success?: boolean; cancelled?: boolean; error?: string }) => void) => {
    void handleCancelLogoGeneration(socket, data, ack)
  },
)
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @airo/agents test:unit logo-cancel-handler`
Expected: PASS (2 tests).
Run: `pnpm --filter @airo/agents typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/logo-cancel-handler.ts agents/src/server/__tests__/logo-cancel-handler.test.ts agents/src/server/ai-lib-websocket-server.ts
git commit -m "feat(agents): cancel_logo_generation socket handler"
```

---

## Task 10: Agent logo-status context injection

Inject the durable `.airo/logo.json` status into the agent's ambient context each turn so it can answer "is my logo ready?". Lives in its own module (avoids `context-builders.ts`' heavy deps and keeps it unit-testable).

**Files:**
- Create: `agents/src/server/logo-status-context.ts`
- Modify: `agents/src/server/ai-lib-websocket-server.ts` (call + push, beside the memory context message)
- Test: `agents/src/server/__tests__/logo-status-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// agents/src/server/__tests__/logo-status-context.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
const mockRead = vi.fn()
vi.mock('../../services/logo/logo-job-state.js', () => ({ readLogoJob: () => mockRead() }))
vi.mock('../../workspace/index.js', () => ({ createForWorkspace: () => ({ files: {} }) }))

import { buildLogoStatusContextMessage } from '../logo-status-context.js'

beforeEach(() => vi.clearAllMocks())

it('returns null when there is no job', async () => {
  mockRead.mockResolvedValueOnce(null)
  expect(await buildLogoStatusContextMessage({ appId: 'app-1' })).toBeNull()
})

it('reports in-progress for a generating job (after_history)', async () => {
  mockRead.mockResolvedValueOnce({ jobId: 'j', status: 'generating', slots: ['logo/horizontal'] })
  const msg = await buildLogoStatusContextMessage({ appId: 'app-1' })
  expect(msg?.content.toLowerCase()).toContain('in progress')
  expect(msg?.insertionOrder).toBe('after_history')
})

it('reports failure with the error message', async () => {
  mockRead.mockResolvedValueOnce({ jobId: 'j', status: 'failed', slots: ['logo/horizontal'], error: 'boom' })
  const msg = await buildLogoStatusContextMessage({ appId: 'app-1' })
  expect(msg?.content).toContain('FAILED')
  expect(msg?.content).toContain('boom')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit logo-status-context`
Expected: FAIL — `Cannot find module '../logo-status-context.js'`.

- [ ] **Step 3: Implement the provider**

```ts
// agents/src/server/logo-status-context.ts
import { logger } from '../logging/index.js'
import { createForWorkspace } from '../workspace/index.js'
import { readLogoJob } from '../services/logo/logo-job-state.js'
import type { ContextMessage } from './context-builders.js'

/** Inject the current logo-job status (from .airo/logo.json) into the agent's
 *  ambient context so it can answer status questions without guessing. */
export async function buildLogoStatusContextMessage(opts: { appId: string }): Promise<ContextMessage | null> {
  const { appId } = opts
  if (!appId) return null
  try {
    const workspace = createForWorkspace(appId, 'preview')?.files ?? null
    if (!workspace) return null
    const job = await readLogoJob(workspace, appId)
    if (!job) return null

    let line: string
    switch (job.status) {
      case 'queued':
      case 'generating':
        line = `Logo generation is currently in progress (status: ${job.status}). The requested layouts (${job.slots.join(', ')}) are showing an animated placeholder and will update automatically when ready. Do not tell the user the logo is finished yet.`
        break
      case 'completed':
        line = `The most recent logo generation completed successfully for: ${job.slots.join(', ')}.`
        break
      case 'failed':
        line = `The most recent logo generation FAILED${job.error ? ` (${job.error})` : ''}. Offer to try generating it again.`
        break
      case 'cancelled':
        line = `The most recent logo generation was cancelled by the user; the previous logo (if any) was restored.`
        break
      default:
        return null
    }

    logger.debug('logo.status.context_inject', { appId, status: job.status, jobId: job.jobId })
    return { role: 'user', content: `## Logo\n- ${line}`, insertionOrder: 'after_history' }
  } catch (err) {
    logger.warn('logo.status.context_failed', {
      appId, error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
```

- [ ] **Step 4: Wire it into the message build**

In `agents/src/server/ai-lib-websocket-server.ts`, beside the existing `buildMemoryContextMessage` call + push, add:

```ts
import { buildLogoStatusContextMessage } from './logo-status-context.js'

// after the memory context message is built:
const logoStatusMessage = await buildLogoStatusContextMessage({
  appId: agentsAppContext.metadata?.appId as string,
})

// after the memory context message is pushed:
if (logoStatusMessage) {
  allMessages.push({
    role: logoStatusMessage.role,
    content: logoStatusMessage.content,
    insertionOrder: logoStatusMessage.insertionOrder,
  })
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @airo/agents test:unit logo-status-context`
Expected: PASS (3 tests).
Run: `pnpm --filter @airo/agents typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/logo-status-context.ts agents/src/server/__tests__/logo-status-context.test.ts agents/src/server/ai-lib-websocket-server.ts
git commit -m "feat(agents): inject logo-job status into agent context each turn"
```

---

## Task 11: Client logo completion store + `handleLogoNotification`

Shared handler (used by the WS `LogoHandler` and SSE path): on a terminal event it records the result in a per-app store (so the chat card can swap in place) and posts `RELOAD_MEDIA_SLOT` per slot (so the preview swaps shimmer→logo / reverts).

**Files:**
- Modify: `app/src/stores/useDevelopPageStore.ts` (add `LogoJobResult` type, `logoJobResults` state, `setLogoJobResult` setter)
- Create: `app/src/hooks/shared/logoNotification.ts`
- Test: `app/src/hooks/shared/__tests__/logoNotification.test.ts`

- [ ] **Step 1: Add the store slice**

Near `LaunchVideoResult` (type ~143) add:

```ts
export interface LogoJobResult {
  jobId: string
  status: 'completed' | 'failed' | 'cancelled'
  slots: string[]
  error?: string
}
```

Add to the store's initial state object: `logoJobResults: {} as Record<string, LogoJobResult | null>,` and to the store interface: `logoJobResults: Record<string, LogoJobResult | null>`.

Near `setLaunchVideoResult` (~1151) add the setter (immer draft style, matching the surrounding setters):

```ts
    setLogoJobResult: (appId: string, result: LogoJobResult | null) => set((state) => {
      state.logoJobResults[appId] = result
    }),
```

Declare `setLogoJobResult: (appId: string, result: LogoJobResult | null) => void` in the store interface.

- [ ] **Step 2: Write the failing test**

```ts
// app/src/hooks/shared/__tests__/logoNotification.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSetLogoJobResult = vi.fn()
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: { getState: () => ({ setLogoJobResult: mockSetLogoJobResult }) },
}))
const mockPostMessageToIframe = vi.fn()
vi.mock('@/utils/postMessage', () => ({ postMessageToIframe: mockPostMessageToIframe }))
const mockAddGrowl = vi.fn()
vi.mock('@ux/growl', () => ({ Growl: { addGrowlMessage: mockAddGrowl } })) // match videoNotification's import
vi.mock('@/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } })) // match videoNotification's import

import { handleLogoNotification } from '../logoNotification'

const t = (id: string) => id
beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = '<iframe id="preview-iframe"></iframe>'
})

describe('handleLogoNotification', () => {
  it('records a completed result and reloads each slot in the preview', () => {
    handleLogoNotification({
      raw: { status: 'completed', appId: 'app-1', jobId: 'job-1', slots: ['logo/horizontal'] },
      clientAppId: 'app-1', t, logPrefix: 'logo.websocket',
    })
    expect(mockSetLogoJobResult).toHaveBeenCalledWith('app-1', expect.objectContaining({ status: 'completed', jobId: 'job-1' }))
    expect(mockPostMessageToIframe).toHaveBeenCalledWith(expect.anything(), { type: 'RELOAD_MEDIA_SLOT', slotPath: 'logo/horizontal' })
    expect(mockAddGrowl).toHaveBeenCalled()
  })

  it('records a failed result with the error', () => {
    handleLogoNotification({
      raw: { status: 'failed', appId: 'app-1', jobId: 'job-1', slots: ['logo/horizontal'], error: 'boom' },
      clientAppId: 'app-1', t, logPrefix: 'logo.websocket',
    })
    expect(mockSetLogoJobResult).toHaveBeenCalledWith('app-1', expect.objectContaining({ status: 'failed', error: 'boom' }))
  })

  it('ignores an event for a different app', () => {
    handleLogoNotification({ raw: { status: 'completed', appId: 'other', jobId: 'j' }, clientAppId: 'app-1', t, logPrefix: 'x' })
    expect(mockSetLogoJobResult).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter website test logoNotification`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `handleLogoNotification`**

Copy the import block from `app/src/hooks/shared/videoNotification.ts` (so `logger`, `Growl`, `useDevelopPageStore` resolve identically), then add `import { postMessageToIframe } from '@/utils/postMessage'`.

```ts
// app/src/hooks/shared/logoNotification.ts
// imports: same as videoNotification.ts (logger, Growl, useDevelopPageStore) + postMessageToIframe

export interface LogoEventData {
  status: string
  appId?: string
  jobId?: string
  slots?: string[]
  error?: string
  slotSaveFailed?: boolean
}

function isLogoEventData(raw: unknown): raw is LogoEventData {
  return !!raw && typeof (raw as { status?: unknown }).status === 'string'
}

export interface HandleLogoNotificationParams {
  raw: Record<string, unknown>
  clientAppId: string | null
  t: (id: string, values?: Record<string, unknown>) => string
  logPrefix: string
}

export function handleLogoNotification(params: HandleLogoNotificationParams): void {
  const { raw, clientAppId, t, logPrefix } = params

  if (!isLogoEventData(raw)) {
    logger.warn(`${logPrefix}.invalid-payload`, { appId: clientAppId, received: typeof (raw as Record<string, unknown>)?.status })
    return
  }

  const { status, appId: payloadAppId, jobId, slots, error } = raw

  if (payloadAppId && clientAppId && payloadAppId !== clientAppId) {
    logger.debug(`${logPrefix}.ignored`, { clientAppId, payloadAppId, reason: 'appId mismatch' })
    return
  }
  const targetAppId = clientAppId ?? payloadAppId
  if (!targetAppId) {
    logger.debug(`${logPrefix}.ignored`, { reason: 'no appId' })
    return
  }

  logger.info(`${logPrefix}.received`, { appId: targetAppId, status, jobId })

  try {
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      useDevelopPageStore.getState().setLogoJobResult(targetAppId, {
        jobId: jobId ?? '', status, slots: slots ?? [], ...(error ? { error } : {}),
      })
    }

    if (Array.isArray(slots) && slots.length > 0 && typeof document !== 'undefined') {
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null
      if (iframe) {
        for (const slotPath of slots) {
          postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath })
          logger.debug(`${logPrefix}.preview_reload`, { appId: targetAppId, slotPath })
        }
      }
    }

    if (status === 'completed') {
      Growl.addGrowlMessage({
        id: `logo-success-${jobId}`,
        title: t('builder_logo_ready_title') || 'Logo ready',
        children: t('builder_logo_ready_description') || 'Your logo has been generated.',
        emphasis: 'success', lifetime: 5000,
      })
      logger.info(`${logPrefix}.completed`, { appId: targetAppId, jobId })
    } else if (status === 'failed') {
      Growl.addGrowlMessage({
        id: `logo-failure-${jobId}`,
        title: t('builder_logo_failed_title') || 'Logo generation failed',
        children: t('builder_logo_failed_description') || 'Your logo could not be generated. Ask me to try again.',
        emphasis: 'critical', lifetime: 8000,
      })
      logger.error(`${logPrefix}.failed`, { appId: targetAppId, jobId, error: error || 'Unknown error' })
    } else if (status === 'cancelled') {
      logger.info(`${logPrefix}.cancelled`, { appId: targetAppId, jobId })
    } else {
      logger.warn(`${logPrefix}.unhandled_status`, { appId: targetAppId, jobId, status })
    }
  } catch (err) {
    logger.warn(`${logPrefix}.notification_failed`, {
      appId: targetAppId, status, error: err instanceof Error ? err.message : String(err),
    })
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter website test logoNotification`
Expected: PASS (3 tests). (Adjust the `@ux/growl` / `@/utils/logger` mock specifiers in the test if videoNotification imports them from different paths.)

- [ ] **Step 6: Commit**

```bash
git add app/src/stores/useDevelopPageStore.ts app/src/hooks/shared/logoNotification.ts app/src/hooks/shared/__tests__/logoNotification.test.ts
git commit -m "feat(app): logo completion store + handleLogoNotification (store + preview reload)"
```

---

## Task 12: `LogoHandler` WebSocket handler + registration

**Files:**
- Create: `app/src/hooks/websocket/handlers/LogoHandler.ts`
- Modify: `app/src/hooks/websocket/handlers/index.ts` (export), `app/src/services/websocket/TransportSupervisor.ts` (import + register)
- Test: `app/src/hooks/websocket/handlers/__tests__/LogoHandler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/hooks/websocket/handlers/__tests__/LogoHandler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
vi.mock('@/hooks/shared/logoNotification', () => ({ handleLogoNotification: mockHandle }))

import { LogoHandler } from '../LogoHandler'

beforeEach(() => vi.clearAllMocks())

describe('LogoHandler', () => {
  it('has type "logo"', () => { expect(new LogoHandler().type).toBe('logo') })

  it('delegates to handleLogoNotification with the message data + app context', async () => {
    const handler = new LogoHandler()
    await handler.handle(
      { type: 'logo', content: '', data: { status: 'completed', jobId: 'job-1', slots: ['logo/horizontal'] } },
      { currentAppId: 'app-1', t: (id: string) => id } as never,
    )
    expect(mockHandle).toHaveBeenCalledWith(expect.objectContaining({
      raw: { status: 'completed', jobId: 'job-1', slots: ['logo/horizontal'] },
      clientAppId: 'app-1', logPrefix: 'logo.websocket',
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test LogoHandler`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `LogoHandler`** (mirror `VideoHandler.ts`)

```ts
// app/src/hooks/websocket/handlers/LogoHandler.ts
import { handleLogoNotification } from '@/hooks/shared/logoNotification'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class LogoHandler implements MessageHandler {
  readonly type = 'logo'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    handleLogoNotification({
      raw: data.data ?? {},
      clientAppId: context.currentAppId,
      t: context.t,
      logPrefix: 'logo.websocket',
    })
  }
}
```

- [ ] **Step 4: Register the handler**

In `app/src/hooks/websocket/handlers/index.ts` add (alphabetically near the others):

```ts
export * from './LogoHandler'
```

In `app/src/services/websocket/TransportSupervisor.ts`, add `LogoHandler` to the import from `@/hooks/websocket/handlers`, and beside `registry.register(new VideoHandler())`:

```ts
    registry.register(new LogoHandler())
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter website test LogoHandler`
Expected: PASS (2 tests).
Run: `pnpm --filter website typecheck` (or `pnpm typecheck`)
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/websocket/handlers/LogoHandler.ts app/src/hooks/websocket/handlers/index.ts app/src/services/websocket/TransportSupervisor.ts app/src/hooks/websocket/handlers/__tests__/LogoHandler.test.ts
git commit -m "feat(app): register LogoHandler for type:'logo' WS events"
```

---

## Task 13: Client cancel emit (`cancelLogoGeneration`)

Mirror `StreamingWebSocketController.stopGeneration()` (verbatim reference in the spec) with a logo-cancel emit, and expose it through the same path `stopGeneration` reaches components.

**Files:**
- Modify: `app/src/services/websocket/StreamingWebSocketController.ts` (add `cancelLogoGeneration`)
- Modify: the hook/context that surfaces `stopGeneration` to components (locate it — search `stopGeneration` usages in `app/src`) to also surface `cancelLogoGeneration`
- Test: `app/src/services/websocket/__tests__/StreamingWebSocketController.cancelLogo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/services/websocket/__tests__/StreamingWebSocketController.cancelLogo.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } })) // match the file's logger import

import { StreamingWebSocketController } from '../StreamingWebSocketController'

describe('StreamingWebSocketController.cancelLogoGeneration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits cancel_logo_generation with the jobId and resolves cancelled', async () => {
    let captured: { event?: string; data?: unknown } = {}
    const fakeSocket = {
      connected: true,
      emit: (event: string, data: unknown, ack: (r: unknown) => void) => {
        captured = { event, data }
        ack({ success: true, cancelled: true })
      },
    }
    const c = Object.create(StreamingWebSocketController.prototype) as StreamingWebSocketController
    ;(c as unknown as { supervisor: unknown }).supervisor = { getSocket: () => fakeSocket }

    const result = await c.cancelLogoGeneration('job-1')
    expect(captured.event).toBe('cancel_logo_generation')
    expect(captured.data).toEqual({ jobId: 'job-1' })
    expect(result).toEqual({ cancelled: true })
  })

  it('resolves cancelled:false when the socket is disconnected', async () => {
    const c = Object.create(StreamingWebSocketController.prototype) as StreamingWebSocketController
    ;(c as unknown as { supervisor: unknown }).supervisor = { getSocket: () => null }
    expect(await c.cancelLogoGeneration('job-1')).toEqual({ cancelled: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test StreamingWebSocketController.cancelLogo`
Expected: FAIL — `cancelLogoGeneration is not a function`.

- [ ] **Step 3: Implement the method** (place beside `stopGeneration`)

```ts
  /**
   * Ask the server to cancel an in-flight background logo generation and revert
   * any placeholder slots. Resolves cancelled:false when there's no socket.
   */
  cancelLogoGeneration(jobId?: string): Promise<{ cancelled: boolean }> {
    const socket = this.supervisor.getSocket()
    if (!socket?.connected) return Promise.resolve({ cancelled: false })

    return new Promise((resolve) => {
      socket.emit(
        'cancel_logo_generation',
        jobId ? { jobId } : {},
        (response: { success?: boolean; cancelled?: boolean; error?: string }) => {
          if (response?.error) logger.warn('websocket.cancel_logo.failed', { error: response.error })
          resolve({ cancelled: !!response?.cancelled })
        },
      )
    })
  }
```

- [ ] **Step 4: Surface it to components**

Find how `stopGeneration` reaches `ChatInput` (search `app/src` for `stopGeneration(` callers / the hook or context that returns it). Add a sibling `cancelLogoGeneration` that calls `controller.cancelLogoGeneration(jobId)` and expose it the same way (so the renderer in Task 14 can call it).

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter website test StreamingWebSocketController.cancelLogo`
Expected: PASS (2 tests).
Run: `pnpm --filter website typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/src/services/websocket/StreamingWebSocketController.ts app/src/services/websocket/__tests__/StreamingWebSocketController.cancelLogo.test.ts
git commit -m "feat(app): cancelLogoGeneration socket emit + expose to components"
```

---

## Task 14: `LogoGeneratorToolRenderer` — shimmer placeholder, in-place swap, Cancel button

The tool now returns `{ started:true, jobId, slots }` (no logos). Add an async branch keyed on `jobId` + the `logoJobResults` store: pending → shimmer + Cancel; completed → show the slot-backed logo images; failed/cancelled → message. Keep the legacy grid/modal path for pre-async chat messages.

**Files:**
- Modify: `app/src/app/[market]/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`
- Test: `app/src/app/[market]/develop/components/tool-renderers/__tests__/LogoGeneratorToolRenderer.async.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// .../tool-renderers/__tests__/LogoGeneratorToolRenderer.async.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockCancel = vi.fn()
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: (sel: (s: unknown) => unknown) => sel({ currentAppId: 'app-1' }),
}))
let storeState: { logoJobResults: Record<string, unknown> } = { logoJobResults: {} }
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (sel: (s: unknown) => unknown) => sel(storeState),
}))
// Mirror the actual hook this renderer uses to obtain cancelLogoGeneration (Task 13, Step 4):
vi.mock('@/hooks/useStreamingControls', () => ({
  useStreamingControls: () => ({ cancelLogoGeneration: mockCancel }),
}))

import LogoGeneratorToolRenderer from '../LogoGeneratorToolRenderer'

const startedResult = { structuredContent: { started: true, jobId: 'job-1', slots: ['logo/horizontal'] } }

beforeEach(() => { vi.clearAllMocks(); storeState = { logoJobResults: {} } })

describe('LogoGeneratorToolRenderer (async)', () => {
  it('shows the generating placeholder + Cancel while pending', () => {
    render(<LogoGeneratorToolRenderer toolName="media-logo__generate_logo" toolStatus="completed" toolId="t1" input="{}" result={startedResult as never} />)
    expect(screen.getByTestId('logo-generating-placeholder')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('logo-cancel-button'))
    expect(mockCancel).toHaveBeenCalledWith('job-1')
  })

  it('shows the generated logo when the store reports completion for this jobId', () => {
    storeState = { logoJobResults: { 'app-1': { jobId: 'job-1', status: 'completed', slots: ['logo/horizontal'] } } }
    render(<LogoGeneratorToolRenderer toolName="media-logo__generate_logo" toolStatus="completed" toolId="t1" input="{}" result={startedResult as never} />)
    const img = screen.getByTestId('logo-result-image-logo/horizontal') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/airo-assets/images/logo/horizontal')
    expect(screen.queryByTestId('logo-generating-placeholder')).not.toBeInTheDocument()
  })

  it('shows an error when the store reports failure', () => {
    storeState = { logoJobResults: { 'app-1': { jobId: 'job-1', status: 'failed', slots: [], error: 'boom' } } }
    render(<LogoGeneratorToolRenderer toolName="media-logo__generate_logo" toolStatus="completed" toolId="t1" input="{}" result={startedResult as never} />)
    expect(screen.getByTestId('logo-error')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test LogoGeneratorToolRenderer.async`
Expected: FAIL — no async branch / testids.

- [ ] **Step 3: Add the async branch to the renderer**

Add imports:

```tsx
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useStreamingControls } from '@/hooks/useStreamingControls' // the hook surfacing cancelLogoGeneration (Task 13 Step 4) — adjust to the real one
```

At the **top of the component body** (before the existing legacy parse/return), add:

```tsx
  const currentAppId = useStreamingConversationStore((s) => s.currentAppId)
  const logoJobResult = useDevelopPageStore((s) => (currentAppId ? s.logoJobResults[currentAppId] : null))
  const { cancelLogoGeneration } = useStreamingControls()

  // New async shape: { started: true, jobId, slots }
  const resultObj = typeof result === 'string' ? safeJsonParse(result) : (result as Record<string, unknown> | undefined)
  const structured = resultObj?.structuredContent as { started?: boolean; jobId?: string; slots?: string[] } | undefined
  const startedJobId = structured?.started ? structured.jobId : undefined

  if (startedJobId) {
    const matched = logoJobResult && logoJobResult.jobId === startedJobId ? logoJobResult : null
    const slots = matched?.slots ?? structured?.slots ?? []

    if (!matched || matched.status === undefined) {
      return (
        <div data-testid="logo-generating-placeholder">
          <ToolHeader icon={<Sparkles className="w-2 h-2" />} displayName="Generating your logo…" toolStatus="running" hasDetails={false} />
          <div className="mt-2 flex items-center gap-2">
            {slots.map((slotPath) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={slotPath} src="/airo-assets/uploads/airo-logo-shimmer.svg" alt="Generating logo" className="w-16 h-16 object-contain rounded" />
            ))}
            <button
              data-testid="logo-cancel-button"
              onClick={() => cancelLogoGeneration(startedJobId)}
              className="text-xs underline text-foreground/60 hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )
    }

    if (matched.status === 'completed') {
      return (
        <div data-testid="logo-result">
          <ToolHeader icon={<Sparkles className="w-2 h-2" />} displayName="Logo ready" toolStatus="completed" hasDetails={false} />
          <div className="mt-2 flex items-center gap-2">
            {slots.map((slotPath) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={slotPath} data-testid={`logo-result-image-${slotPath}`} src={`/airo-assets/images/${slotPath}`} alt="Generated logo" className="w-16 h-16 object-contain rounded" />
            ))}
          </div>
        </div>
      )
    }

    if (matched.status === 'failed') {
      return (
        <div data-testid="logo-error">
          <ToolHeader icon={<Sparkles className="w-2 h-2" />} displayName="Logo generation failed" toolStatus="error" hasDetails={false} />
          <p className="text-xs text-foreground/60 mt-1">{matched.error || 'Generation failed. Ask me to try again.'}</p>
        </div>
      )
    }

    if (matched.status === 'cancelled') {
      return (
        <div data-testid="logo-cancelled">
          <ToolHeader icon={<Sparkles className="w-2 h-2" />} displayName="Logo generation cancelled" toolStatus="completed" hasDetails={false} />
        </div>
      )
    }
  }
```

Add a `safeJsonParse` helper near the top of the file:

```tsx
function safeJsonParse(s: string): Record<string, unknown> | undefined {
  try { return JSON.parse(s) as Record<string, unknown> } catch { return undefined }
}
```

Leave the existing legacy parse + grid/modal `return (...)` block below this branch untouched (it still renders pre-async chat messages that carried `structuredContent.logo`/`logos`).

> Replace the inline display strings with i18n `t(...)` keys in Task 15 — leaving literals here keeps this task's test green first.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter website test LogoGeneratorToolRenderer`
Expected: PASS (async + any existing legacy tests).

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/[market]/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx" "app/src/app/[market]/develop/components/tool-renderers/__tests__/LogoGeneratorToolRenderer.async.test.tsx"
git commit -m "feat(app): async logo card — shimmer placeholder, cancel, in-place completion swap"
```

---

## Task 15: i18n strings

Pre-commit validates translation keys (blocks on missing), so create the keys **before** wiring them.

**Files:**
- Modify: `app/src/hooks/shared/logoNotification.ts` (toast keys), `app/src/app/[market]/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx` (card strings → `t(...)`)

- [ ] **Step 1: Create the keys**

Check existing keys first: `GET https://api.i18n.int.gdcorp.tools/api/v2/package/market/en-US/%40airo-app-builder%2Faab`. Create any missing at https://i18n.int.gdcorp.tools/org/hcx/app/aab (PARTNERSTRANSLATIONS AD group):

| Key | en-US value |
|---|---|
| `builder_logo_generating` | Generating your logo… |
| `builder_logo_cancel` | Cancel |
| `builder_logo_ready_title` | Logo ready |
| `builder_logo_ready_description` | Your logo has been generated. |
| `builder_logo_failed_title` | Logo generation failed |
| `builder_logo_failed_description` | Your logo could not be generated. Ask me to try again. |
| `builder_logo_cancelled` | Logo generation cancelled |

- [ ] **Step 2: Wire `t(...)` into the renderer**

Obtain `t` from the app's standard translation hook (match the other tool-renderers — search a sibling renderer for `useTranslation`/`useIntl`/`t(`). Replace the literal display strings added in Task 14 (`'Generating your logo…'`, `'Cancel'`, `'Logo ready'`, `'Logo generation failed'`, the failure fallback, `'Logo generation cancelled'`) with the keys above. The `logoNotification.ts` toasts already reference these keys with literal fallbacks — once the keys exist they resolve from the catalog.

- [ ] **Step 3: Verify**

Run: `pnpm --filter website test LogoGeneratorToolRenderer logoNotification`
Expected: PASS (Task 14/11 tests assert `data-testid`s, not text, so the swap is safe).
Run the i18n validation (the pre-commit check, or commit to trigger it).
Expected: no missing-key errors.

- [ ] **Step 4: Commit**

```bash
git add "app/src/hooks/shared/logoNotification.ts" "app/src/app/[market]/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx"
git commit -m "feat(app): i18n strings for async logo status/toasts"
```

---

## Task 16: E2E regression coverage

**Files:**
- Modify: `tests/regression/develop-media.spec.ts` (un-skip + update the logo-grid spec, ~lines 186-198)

- [ ] **Step 1: Update the flow**

The skipped spec (`'Logo grid — click-to-save auto-swaps slot and updates Brand Book'`) assumed a synchronous result. Rewrite it for the async flow:
1. Trigger a logo generation in chat.
2. Assert the placeholder appears: `await expect(page.getByTestId('logo-generating-placeholder')).toBeVisible()`.
3. Wait for completion: `await expect(page.getByTestId('logo-result')).toBeVisible({ timeout: 120_000 })` (logo gen takes 30s+).
4. Assert the preview/Brand Book reflect the new logo (reuse the existing Brand Book assertions from the old spec).
5. Optional cancel-path spec: trigger generation, click `getByTestId('logo-cancel-button')`, assert the placeholder disappears and the prior logo (or empty state) is restored.

- [ ] **Step 2: Grep for stale selectors**

Run: `grep -rn "logo" tests/e2e tests/regression` — update any selectors that depended on the old synchronous logo grid to the new `data-testid`s (`logo-generating-placeholder`, `logo-cancel-button`, `logo-result`, `logo-result-image-<slot>`, `logo-error`).

- [ ] **Step 3: Run (if the E2E harness is available locally) + commit**

```bash
git add tests/regression/develop-media.spec.ts
git commit -m "test(e2e): async logo flow — placeholder, completion, cancel"
```

---

## Task 17: Full PR-readiness verification

- [ ] **Step 1: Run the full gate**

```bash
pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents lint && pnpm --filter @airo/agents test:unit
pnpm --filter website typecheck && pnpm --filter website lint && pnpm --filter website test
pnpm build
```
Expected: all green. Fix any failures before opening the PR.

- [ ] **Step 2: Manual smoke (optional, `pnpm run dev`)**

Generate a logo in chat → confirm the placeholder appears immediately in chat **and** on the website preview, the agent continues, and on completion the chat card + preview swap to the real logo. Then regenerate and Cancel mid-way → confirm revert. Force a failure (e.g. stub a 500) → confirm error surfacing + slot revert. Ask "is my logo ready?" mid-generation → confirm the agent reports in-progress.

- [ ] **Step 3: Open the PR** (use the project PR checklist in the root `CLAUDE.md`).

---

## Plan self-review (completed by author)

- **Spec coverage:** every spec section maps to a task — durable state (T1), shimmer (T2), AbortSignal (T3), `removeSlot`/`pendingJobId` (T4), shared slot helpers + snapshot/revert (T5), worker/retry/supersede/emit (T6), async tool (T7), `set_venture_logo` (T8), cancel socket (T9), agent status context (T10), client store + notification (T11), `LogoHandler` (T12), cancel emit (T13), renderer (T14), i18n (T15), E2E (T16). Logging events from spec §8 are distributed across T1–T10. AAB-only is preserved (the existing PaaS guard in `generate_logo` is untouched).
- **Type consistency:** `LogoJob`, `StartLogoParams/Result`, the `{type:'logo', data:{status,jobId,slots}}` emit payload, `LogoJobResult`, `LOGO_SHIMMER_SLOT_URL`, and `cancelLogoGeneration(jobId)` are defined once and consumed consistently downstream.
- **Known "locate & mirror" points** (verify against the codebase during execution; each has a grep target): the hook surfacing `stopGeneration`→`cancelLogoGeneration` (T13 §4 / T14), the `Growl`/`logger` import specifiers (T11, mirror `videoNotification.ts`), `MediaManifestService`' `appRepository` import + manifest filename (T4), and the per-socket setup location in `ai-lib-websocket-server.ts` (T9).
- **Circular import note:** `LogoGenerationService` → `emitToApp` (in `ai-lib-websocket-server.ts`) mirrors `video-generation-tool.ts`; the binding is only called at runtime, so the ESM cycle resolves (same proven pattern).









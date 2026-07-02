import type { UploadClassification } from './FileUploadContextRenderer.js'
import type { WorkspaceClient } from '../../workspace/index.js'
import { createForWorkspace } from '../../workspace/index.js'
import { logger } from '../../logging/index.js'

export const UPLOAD_CLASSIFICATIONS_PATH = 'docs/.upload-classifications.json'

export type PersistedUploadClassification = UploadClassification & {
  fileName: string
  slotUrl?: string
  storedUploadFilename?: string
  /** Set once the agent has actually PLACED this upload — see context-manager re-injection logic. */
  placed?: boolean
  /** Carried forward so continuation turns rebuild describe-before-replace guidance (AIROBUILD-2789). */
  deflectedFromCanonical?: boolean
}

/**
 * Per-app mutex over `docs/.upload-classifications.json`. Two writers take it —
 * `persistClassifications` (the renderers) and `markUploadsPlaced` (after
 * placement; `recordUploadSlotUrl` delegates to it) — and both read-modify-
 * write. Without serialization a placement mark can be lost under a concurrent
 * classify-persist, which would resurrect a placed upload as a pending task.
 *
 * NOTE: this Map is in-process, so it serializes only within ONE agents
 * process. That is sufficient under the one-agent-per-app production topology;
 * a multi-writer-process setup would need a cross-process lock.
 */
const classificationLocks: Map<string, Promise<void>> = new Map<string, Promise<void>>()

async function withClassificationLock<T>(appId: string, fn: () => Promise<T>): Promise<T> {
  while (classificationLocks.has(appId)) {
    await classificationLocks.get(appId)
  }
  let release: () => void = () => {}
  const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
    release = resolve
  })
  classificationLocks.set(appId, gate)
  try {
    return await fn()
  } finally {
    classificationLocks.delete(appId)
    release()
  }
}

async function readEntries(workspace: WorkspaceClient): Promise<PersistedUploadClassification[]> {
  try {
    const content: string = await workspace.files.readText({ path: UPLOAD_CLASSIFICATIONS_PATH })
    const parsed: { files?: PersistedUploadClassification[] } = JSON.parse(content)
    if (!Array.isArray(parsed?.files)) return []
    return parsed.files.filter(
      (entry: PersistedUploadClassification): boolean => !!entry && typeof entry.fileName === 'string',
    )
  } catch {
    // Not found / unreadable / malformed — treat as nothing classified yet.
    return []
  }
}

async function writeEntries(workspace: WorkspaceClient, entries: PersistedUploadClassification[]): Promise<void> {
  await workspace.files.write({
    path: UPLOAD_CLASSIFICATIONS_PATH,
    content: JSON.stringify({ files: entries }, null, 2),
    encoding: 'utf-8',
  })
}

/**
 * Read the persisted per-file classifications, keyed by fileName. Missing,
 * unreadable, or malformed file → empty map (treated as "nothing classified
 * yet"). Shared by both upload renderers so an upload classified on one path
 * (file_upload or selected_assets) is recognised by the other and is not
 * re-classified on a later turn.
 */
export async function readPersistedClassifications(
  workspace: WorkspaceClient,
): Promise<Map<string, PersistedUploadClassification>> {
  const byName: Map<string, PersistedUploadClassification> = new Map<string, PersistedUploadClassification>()
  for (const entry of await readEntries(workspace)) {
    byName.set(entry.fileName, entry)
  }
  return byName
}

/**
 * Persist classifications, merging with whatever is already on disk — re-read
 * under the lock rather than trusting a snapshot taken earlier — so a
 * concurrent placement mark is never clobbered. A freshly-classified entry
 * comes from the current turn's attachment (the user is actively re-engaging
 * that upload), so it overwrites the prior entry and is treated as not-yet-
 * placed until a placement marks it again.
 */
export async function persistClassifications(
  workspace: WorkspaceClient,
  entries: PersistedUploadClassification[],
  appId: string,
): Promise<void> {
  if (entries.length === 0) return
  try {
    await withClassificationLock(appId, async (): Promise<void> => {
      const merged: Map<string, PersistedUploadClassification> = new Map<string, PersistedUploadClassification>()
      for (const entry of await readEntries(workspace)) {
        merged.set(entry.fileName, entry)
      }
      for (const entry of entries) {
        merged.set(entry.fileName, entry)
      }
      await writeEntries(workspace, [...merged.values()])
    })
  } catch (err) {
    logger.warn('context.renderer.upload_classification.persist_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Mark an upload as placed (and optionally record its resolved slot URL) so the
 * context manager stops re-injecting it as a pending task. Matches by stored
 * filename or original display name. Best-effort and non-fatal — callers
 * fire-and-forget; a failure just means the upload may be re-surfaced once more.
 */
export async function markUploadsPlaced(params: {
  appId: string
  storedFilename?: string | null
  fileName?: string | null
  slotUrl?: string | null
}): Promise<boolean> {
  const { appId, storedFilename, fileName, slotUrl } = params
  if (!storedFilename && !fileName) return false
  try {
    const workspace: WorkspaceClient | null = createForWorkspace(appId, 'preview')
    if (!workspace) return false
    return await withClassificationLock(appId, async (): Promise<boolean> => {
      const entries: PersistedUploadClassification[] = await readEntries(workspace)
      let changed: boolean = false
      for (const entry of entries) {
        const matches: boolean =
          (!!storedFilename && (entry.storedUploadFilename === storedFilename || entry.fileName === storedFilename)) ||
          (!!fileName && entry.fileName === fileName)
        if (!matches) continue
        if (entry.placed !== true) {
          entry.placed = true
          changed = true
        }
        if (slotUrl && entry.slotUrl !== slotUrl) {
          entry.slotUrl = slotUrl
          changed = true
        }
      }
      if (changed) await writeEntries(workspace, entries)
      return changed
    })
  } catch (error) {
    logger.warn('upload_classification.mark_placed.failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

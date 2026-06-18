import type { UploadClassification } from './FileUploadContextRenderer.js'
import type { WorkspaceClient } from '../../workspace/index.js'
import { logger } from '../../logging/index.js'

export const UPLOAD_CLASSIFICATIONS_PATH = 'docs/.upload-classifications.json'

export type PersistedUploadClassification = UploadClassification & {
  fileName: string
  slotUrl?: string
  storedUploadFilename?: string
}

/**
 * Read the persisted per-file classifications, keyed by fileName. Missing,
 * unreadable, or malformed file → empty map (treated as "nothing classified
 * yet"). Shared by both upload renderers so an upload classified on one path
 * (file_upload or selected_assets) is recognised by the other and is not
 * re-classified on a later turn — the context manager re-injects these every
 * turn, so a fresh LLM classify would be wasted spend and could contradict the
 * persisted result when the current turn's prompt differs (e.g. a handoff).
 */
export async function readPersistedClassifications(
  workspace: WorkspaceClient,
): Promise<Map<string, PersistedUploadClassification>> {
  const byName = new Map<string, PersistedUploadClassification>()
  try {
    const view = await workspace.files.view({ path: UPLOAD_CLASSIFICATIONS_PATH, limit: 65536 })
    const parsed = JSON.parse(view.content) as { files?: PersistedUploadClassification[] }
    if (Array.isArray(parsed?.files)) {
      for (const entry of parsed.files) {
        if (entry && typeof entry.fileName === 'string') byName.set(entry.fileName, entry)
      }
    }
  } catch {
    // Not found / unreadable / malformed — treat as nothing classified yet.
  }
  return byName
}

/**
 * Persist classifications, merging with prior entries (keyed by fileName) so
 * writing this turn's subset never drops classifications written earlier.
 */
export async function persistClassifications(
  workspace: WorkspaceClient,
  entries: PersistedUploadClassification[],
  existing: Map<string, PersistedUploadClassification>,
): Promise<void> {
  try {
    const merged = new Map(existing)
    for (const entry of entries) merged.set(entry.fileName, entry)
    await workspace.files.write({
      path: UPLOAD_CLASSIFICATIONS_PATH,
      content: JSON.stringify({ files: [...merged.values()] }, null, 2),
      encoding: 'utf-8',
    })
  } catch (err) {
    logger.warn('context.renderer.upload_classification.persist_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

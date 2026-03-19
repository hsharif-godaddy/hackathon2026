import type { UploadedFile } from '../services/FileUploadService.js'
import { logger } from '../logging/index.js'

/**
 * Tracks which uploaded files have been matched via extension-fallback resolution.
 * Prevents multiple file_edit calls from resolving to the same uploaded file
 * when the LLM uses custom filenames (e.g., "slide-hero.jpg" instead of original name).
 *
 * Key: appId, Value: Set of stored filenames (unique per file) already consumed by extension matching.
 * Exact-match resolutions are NOT tracked — they always work regardless.
 *
 * IMPORTANT: The pick-and-mark operation is atomic (single synchronous function call)
 * to avoid race conditions when multiple file_edit tool calls run concurrently
 * via Promise.all in the Vercel AI SDK.
 */
const extensionResolvedFiles = new Map<string, Set<string>>()

/**
 * Atomically pick the best candidate from a list of extension-matched uploads
 * and mark it as consumed. This MUST be a single synchronous call to prevent
 * race conditions when parallel tool calls resolve uploads concurrently.
 *
 * @param appId - Application ID
 * @param candidates - Files that matched by extension
 * @param compareFn - Comparator to rank candidates (negative = a is better, like Array.sort)
 * @returns The selected file, or null if candidates is empty
 */
export function pickAndMarkExtensionResolved(
  appId: string,
  candidates: UploadedFile[],
  compareFn: (a: UploadedFile, b: UploadedFile) => number
): UploadedFile | null {
  if (candidates.length === 0) return null

  let consumed = extensionResolvedFiles.get(appId)
  if (!consumed) {
    consumed = new Set()
    extensionResolvedFiles.set(appId, consumed)
  }

  // Prefer unconsumed candidates; fall back to all if every candidate is consumed
  // Track by unique stored filename, not originalName, to handle multiple
  // uploads with the same originalName (e.g., "folder1/hero.jpg" and "folder2/hero.jpg")
  const unconsumed = candidates.filter(f => !consumed!.has(f.filename))
  const pool = unconsumed.length > 0 ? unconsumed : candidates

  if (unconsumed.length === 0) {
    logger.warn('file-edit.auto-resolve.all-consumed', {
      appId,
      candidateCount: candidates.length,
      consumedCount: consumed.size
    })
  }

  // Sort and pick the best (first after sort)
  const sorted = [...pool].sort(compareFn)
  const best = sorted[0]!

  // Mark as consumed — this is synchronous, no yield, so no race
  consumed.add(best.filename)

  return best
}

export function clearExtensionResolved(appId: string): void {
  extensionResolvedFiles.delete(appId)
}

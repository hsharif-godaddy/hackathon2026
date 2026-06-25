/**
 * Pull the unique stored filename out of an agent upload URL
 * (`/files/uploads/{appId}/{storedFilename}`, possibly signed). Returns null
 * for non-upload URLs (and for an empty/undefined URL). The stored filename
 * embeds a timestamp + id, so it identifies the EXACT upload even when two
 * assets share the same display name — unlike the display name, which a
 * re-upload reuses.
 *
 * Shared by the develop-chat renderer (binds the fresh stored filename to an
 * attachment) and the context manager (overrides a stale persisted filename on
 * a correction turn) so the parse lives in one place.
 */
export function extractStoredUploadFilename(imageUrl: string | undefined): string | null {
  if (!imageUrl) return null
  const cleanUrl: string = imageUrl.split('?')[0] ?? imageUrl
  const match: RegExpMatchArray | null = cleanUrl.match(/\/files\/uploads\/[^/]+\/([^/]+)$/)
  if (!match || !match[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

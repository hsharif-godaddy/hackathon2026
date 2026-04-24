/**
 * Parses the AI_CHUNK_TIMEOUT_MS environment variable.
 *
 * Returns the parsed millisecond value when the env var is set to a
 * valid positive integer; returns undefined otherwise (unset, zero,
 * negative, non-numeric, NaN, Infinity).
 */
export function parseChunkTimeoutMs(): number | undefined {
  const raw = process.env.AI_CHUNK_TIMEOUT_MS
  if (!raw) {
    return undefined
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return undefined
  }
  return parsed
}

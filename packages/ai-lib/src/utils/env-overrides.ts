/**
 * Parses the AI_CHUNK_TIMEOUT_MS environment variable.
 *
 * Returns the parsed millisecond value when the env var is set to a
 * positive integer, or `-1` to disable the guard entirely.
 * Returns undefined otherwise (unset, zero, other negatives,
 * non-numeric, NaN, Infinity).
 *
 * `-1` means "disabled": the chunk timeout guard will not be created.
 */
export function parseChunkTimeoutMs(): number | undefined {
  const raw = process.env.AI_CHUNK_TIMEOUT_MS
  if (!raw) {
    return undefined
  }
  const parsed = Number(raw)
  if (parsed === -1) return -1
  if (
    !Number.isFinite(parsed)
    || !Number.isInteger(parsed)
    || parsed < 1
  ) {
    return undefined
  }
  return parsed
}

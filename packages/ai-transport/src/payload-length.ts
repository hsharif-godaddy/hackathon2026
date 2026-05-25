/**
 * Recursive sum of string lengths in nested objects/arrays. Counts every string field on
 * attachments (type, persistence, renderStrategy, source, etc.), not only payload content.
 * Uses a WeakSet to skip circular references.
 */
export function stringPayloadLength(value: unknown, seen?: WeakSet<object>): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'string') return value.length
  if (typeof value === 'number' || typeof value === 'boolean') return 0
  if (typeof value === 'object') {
    const visited = seen ?? new WeakSet<object>()
    if (visited.has(value as object)) return 0
    visited.add(value as object)
    let total = 0
    if (Array.isArray(value)) {
      for (const item of value) total += stringPayloadLength(item, visited)
    } else {
      for (const item of Object.values(value as Record<string, unknown>)) {
        total += stringPayloadLength(item, visited)
      }
    }
    return total
  }
  return 0
}

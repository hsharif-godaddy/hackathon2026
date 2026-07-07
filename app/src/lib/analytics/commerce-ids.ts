const PLACEHOLDER_VALUES = new Set([
  'REPLACE_WITH_STORE_ID',
  'REPLACE_WITH_CHANNEL_ID',
])

export function isConfiguredValue(value: string | undefined): value is string {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed || PLACEHOLDER_VALUES.has(trimmed)) return false
  return true
}

/**
 * App-layer validation for enum-backed columns.
 *
 * The campaign tables intentionally have no DB CHECK/lookup constraint on their enum
 * columns: SQLite cannot alter a CHECK in place, and a lookup table would force a DB
 * migration to add a value. Instead the TS enum is the single source of truth and we
 * validate against it here, before persisting — so adding a value is a code-only change.
 */
export function assertEnumValue<T extends Record<string, string>>(
  enumObj: T,
  value: string,
  label: string,
): void {
  const allowed: string[] = Object.values(enumObj);
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${label}: ${value} (expected one of ${allowed.join(', ')})`);
  }
}

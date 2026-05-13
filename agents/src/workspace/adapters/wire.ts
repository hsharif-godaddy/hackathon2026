/**
 * Hydrate a wire timestamp (ISO-8601 string) into a Date, treating Go zero
 * values and unparseable strings as "absent". The supervisor sometimes emits
 * `"0001-01-01T00:00:00Z"` for unset times — JS will parse it into a real
 * Date, which leaks through truthy checks, so we filter those out here.
 */
export function safeDate(value: string | undefined | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  const t = d.getTime();
  if (!Number.isFinite(t)) return undefined;
  // Anything before 1971 is treated as a zero value (Go's 0001-01-01,
  // Unix epoch from a missing field, etc.).
  if (d.getUTCFullYear() < 1971) return undefined;
  return d;
}

/**
 * Coerces an unknown value to a finite number.
 * Returns {@link fallback} when `Number(value)`
 * yields NaN or +/-Infinity.
 */
export function toFiniteNumber(
  value: unknown,
  fallback: number,
): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

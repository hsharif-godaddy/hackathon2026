/**
 * True when `shopperId` is a GoDaddy TLA (three-letter account) — internal
 * employee accounts use exactly three characters.
 */
export function isTLAShopper(shopperId: unknown): boolean {
  return typeof shopperId === 'string' && shopperId.length === 3;
}

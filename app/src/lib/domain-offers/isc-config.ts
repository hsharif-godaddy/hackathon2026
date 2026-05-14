export const KNOWN_ISC_CODES = [
  'GDWELCOME',
  'GOTIME',
  'GOGERMANY',
  'GOINDIA',
] as const;

export type KnownIsc = (typeof KNOWN_ISC_CODES)[number];

export function normalizeIsc(
  raw: string | null | undefined
): KnownIsc | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (!upper) return null;
  return (KNOWN_ISC_CODES as readonly string[]).includes(upper)
    ? (upper as KnownIsc)
    : null;
}

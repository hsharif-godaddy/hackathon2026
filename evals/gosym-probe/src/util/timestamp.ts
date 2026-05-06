/**
 * Converts an ISO 8601 timestamp to compact yyyymmddHHmmss format.
 * Used to build sortable, human-readable directory name prefixes.
 */
export function toCompactTimestamp(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getUTCFullYear().toString();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  const HH = d.getUTCHours().toString().padStart(2, '0');
  const MM = d.getUTCMinutes().toString().padStart(2, '0');
  const ss = d.getUTCSeconds().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}${HH}${MM}${ss}`;
}

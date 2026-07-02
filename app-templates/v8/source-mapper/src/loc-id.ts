// Mirror: agents/src/tools/content-loc-id.ts (identical body — separate build roots prevent cross-package import)

export function arrayDeclaratorLocId(
  loc: { start: { line: number; column: number } } | null | undefined,
): string | null {
  if (!loc) return null;
  return `L${loc.start.line}C${loc.start.column}`;
}

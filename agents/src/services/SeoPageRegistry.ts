/**
 * In-memory registry of SEO validation state for page files edited during the
 * current session. Updated on every write to a page file so mark_done can check
 * completeness without re-reading files. Resets on process restart — intentional,
 * since todo lists reset too.
 */

// appId → (filePath → missing element names)
const registry = new Map<string, Map<string, string[]>>();

export function recordPageSeoState(appId: string, filePath: string, missing: string[]): void {
  if (!registry.has(appId)) {
    registry.set(appId, new Map());
  }
  registry.get(appId)!.set(filePath, missing);
}

export function getPageSeoGaps(appId: string): Array<{ filePath: string; missing: string[] }> {
  const map = registry.get(appId);
  if (!map) return [];
  return [...map.entries()]
    .filter(([, missing]) => missing.length > 0)
    .map(([filePath, missing]) => ({ filePath, missing }));
}

/**
 * Single source of truth for platform-managed paths hidden from customer-facing
 * surfaces. Consumed by DirectoryListingTool, code-search, and file-search.
 */
type PlatformInfrastructureEntry =
  | { readonly kind: 'directory'; readonly name: string }
  | { readonly kind: 'file'; readonly name: string };

const PLATFORM_INFRASTRUCTURE_ENTRIES = [
  { kind: 'directory', name: 'dev-supervisor' },
  { kind: 'directory', name: 'dev-tools' },
  { kind: 'directory', name: 'airo-secrets' },
  { kind: 'directory', name: 'source-mapper' },
  { kind: 'file', name: 'fullstory-plugin.ts' },
] as const satisfies readonly PlatformInfrastructureEntry[];

export const PLATFORM_INFRASTRUCTURE_PATHS = PLATFORM_INFRASTRUCTURE_ENTRIES.map(
  (entry) => entry.name,
);

export function isPlatformInfrastructurePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');

  for (const entry of PLATFORM_INFRASTRUCTURE_ENTRIES) {
    if (entry.kind === 'file') {
      if (normalized === entry.name) {
        return true;
      }
      continue;
    }

    if (normalized === entry.name || normalized.startsWith(`${entry.name}/`)) {
      return true;
    }
  }

  return false;
}

export function platformInfrastructureExcludeGlobs(): readonly string[] {
  return PLATFORM_INFRASTRUCTURE_ENTRIES.map((entry) =>
    entry.kind === 'file' ? `!/${entry.name}` : `!${entry.name}/**`,
  );
}

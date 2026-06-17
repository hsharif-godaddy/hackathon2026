import type { Domain, DomainSearchMeta } from '@/types/domain-purchase';

export interface DomainSelectionAnalyticsContext {
  resultIndex: number;
  isExactMatch: boolean;
  seedsUsed: DomainSearchMeta['seedsUsed'];
  seedsCount: number;
}

export function buildSearchResultsLogKey(
  searchQuery: string,
  domains: Domain[],
  meta: DomainSearchMeta | undefined,
): string {
  return [
    searchQuery,
    domains.length,
    meta?.totalBeforeCap ?? domains.length,
    meta?.seedsUsed ?? 'fallback',
    domains[0]?.fqdn ?? '',
  ].join(':');
}

export function domainSelectionContext(
  meta: DomainSearchMeta | undefined,
  domain: Domain,
  resultIndex: number,
): DomainSelectionAnalyticsContext {
  return {
    resultIndex,
    isExactMatch: domain.isExactMatch ?? false,
    seedsUsed: meta?.seedsUsed ?? 'fallback',
    seedsCount: meta?.seedsCount ?? 0,
  };
}

export function selectedDomainSelectionContext(
  meta: DomainSearchMeta | undefined,
  domains: Domain[] | undefined,
  selectedDomain: Domain | null,
): DomainSelectionAnalyticsContext | Record<string, never> {
  if (!selectedDomain) return {};
  const resultIndex = domains?.findIndex((d) => d.fqdn === selectedDomain.fqdn) ?? -1;
  return domainSelectionContext(meta, selectedDomain, resultIndex);
}

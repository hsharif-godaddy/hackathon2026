/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import type { Domain, DomainSearchMeta } from '@/types/domain-purchase';
import {
  buildSearchResultsLogKey,
  domainSelectionContext,
  selectedDomainSelectionContext,
} from './domain-search-analytics';

const mockDomain = (fqdn: string, isExactMatch = false): Domain => ({
  fqdn,
  sld: fqdn.split('.')[0],
  tld: '.com',
  availabilityCode: 1000,
  productId: 1,
  isPremium: false,
  isExactMatch,
});

const mockMeta = (overrides: Partial<DomainSearchMeta> = {}): DomainSearchMeta => ({
  seedsUsed: 'fallback',
  seedsCount: 0,
  spinsFulfilled: 1,
  spinsRejected: 0,
  spinsResultCount: 1,
  exactMatchCount: 0,
  totalBeforeCap: 1,
  ...overrides,
});

describe('domain-search-analytics', function analyticsTests() {
  describe('buildSearchResultsLogKey', function logKeyTests() {
    it('uses query, count, totalBeforeCap, seedsUsed, and first domain', function stableKey() {
      const key = buildSearchResultsLogKey(
        'my brand',
        [mockDomain('spin.com'), mockDomain('other.com')],
        mockMeta({ totalBeforeCap: 4, seedsUsed: 'llm' }),
      );

      expect(key).toBe('my brand:2:4:llm:spin.com');
    });
  });

  describe('domainSelectionContext', function selectionTests() {
    it('defaults seedsUsed to fallback when meta is absent', function fallbackSeeds() {
      expect(domainSelectionContext(undefined, mockDomain('spin.com'), 2)).toEqual({
        resultIndex: 2,
        isExactMatch: false,
        seedsUsed: 'fallback',
        seedsCount: 0,
      });
    });
  });

  describe('selectedDomainSelectionContext', function selectedTests() {
    it('returns empty object when no domain is selected', function noSelection() {
      expect(selectedDomainSelectionContext(mockMeta(), [mockDomain('a.com')], null)).toEqual({});
    });

    it('finds result index from the domain list', function findsIndex() {
      const domains = [mockDomain('a.com', true), mockDomain('b.com')];
      expect(selectedDomainSelectionContext(mockMeta(), domains, domains[1])).toEqual({
        resultIndex: 1,
        isExactMatch: false,
        seedsUsed: 'fallback',
        seedsCount: 0,
      });
    });
  });
});

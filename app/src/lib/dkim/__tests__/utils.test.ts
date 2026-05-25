import { describe, expect, it } from 'vitest';

import type { AiroDomainDnsOwnershipResponse } from '@/lib/mgmt-airo/types';
import {
  deriveDomainOrigin,
  DomainOrigin,
  getNextRotationDate,
} from '../utils';

describe('getNextRotationDate', () => {
  it('returns ISO string ~6 months in future', () => {
    const now = Date.now();
    const result = getNextRotationDate();
    const ts = new Date(result).getTime();
    expect(ts).toBeGreaterThan(now + 5 * 30 * 24 * 60 * 60 * 1000);
    expect(ts).toBeLessThan(now + 8 * 30 * 24 * 60 * 60 * 1000);
  });

  it('applies jitter within ±jitterDays', () => {
    const base = new Date();
    base.setMonth(base.getMonth() + 6);
    const jitterDays = 14;
    const results = Array.from({ length: 20 }, () => new Date(getNextRotationDate(6, jitterDays)).getTime());
    const min = base.getTime() - jitterDays * 24 * 60 * 60 * 1000;
    const max = base.getTime() + jitterDays * 24 * 60 * 60 * 1000;
    for (const ts of results) {
      expect(ts).toBeGreaterThanOrEqual(min);
      expect(ts).toBeLessThanOrEqual(max);
    }
  });

  it('produces valid ISO format', () => {
    const result = getNextRotationDate();
    const parsed = new Date(result);
    expect(parsed.toISOString()).toBe(result);
  });
});

describe('deriveDomainOrigin', () => {
  const base: AiroDomainDnsOwnershipResponse = {
    isGdDomain: false,
    isGDDomainOwner: false,
    isGoDaddyDns: false,
    pendingNsPropagation: false,
    domainCreatedAt: null,
    zoneMatchedAt: null,
    nameserverType: '',
    nameservers: [],
    dnsApiResponseCode: null,
    domainsApiResponseCode: null,
  };

  it('returns INTERNAL when isGoDaddyDns is true', () => {
    expect(deriveDomainOrigin({ ...base, isGoDaddyDns: true })).toBe(DomainOrigin.INTERNAL);
  });

  it('returns EXTERNAL when isGoDaddyDns is false', () => {
    expect(deriveDomainOrigin({ ...base, isGoDaddyDns: false })).toBe(DomainOrigin.EXTERNAL);
  });

  it('returns EXTERNAL when isGdDomain true but isGoDaddyDns false', () => {
    expect(deriveDomainOrigin({ ...base, isGdDomain: true, isGoDaddyDns: false })).toBe(DomainOrigin.EXTERNAL);
  });
});

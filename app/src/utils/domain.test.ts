import { describe, expect, it } from 'vitest';

import { DomainStatus, DomainType, type SiteDomain } from '@/lib/control-plane/types';
import {
  dedupeSiteDomainsByFqdn,
  findCustomerDomain,
  getDnsRecords,
  hasExternalNameservers,
  isAiroSubdomain,
  isBlockedAiroDomain,
  isCustomerDomain,
  normalizeFqdn,
  parseDomain,
  resolveSiteFqdn,
  sanitizeDomainInput,
  validateDomain,
} from './domain';

describe('sanitizeDomainInput', () => {
  it('should remove http:// protocol', () => {
    expect(sanitizeDomainInput('http://example.com')).toBe('example.com');
  });

  it('should remove https:// protocol', () => {
    expect(sanitizeDomainInput('https://example.com')).toBe('example.com');
  });

  it('should remove trailing slashes', () => {
    expect(sanitizeDomainInput('example.com/')).toBe('example.com');
    expect(sanitizeDomainInput('https://example.com/')).toBe('example.com');
  });

  it('should remove paths', () => {
    expect(sanitizeDomainInput('example.com/path/to/page')).toBe('example.com');
    expect(sanitizeDomainInput('https://example.com/api/v1')).toBe('example.com');
  });

  it('should remove port numbers', () => {
    expect(sanitizeDomainInput('example.com:8080')).toBe('example.com');
    expect(sanitizeDomainInput('https://example.com:443')).toBe('example.com');
  });

  it('should trim whitespace', () => {
    expect(sanitizeDomainInput('  example.com  ')).toBe('example.com');
  });

  it('should handle empty string', () => {
    expect(sanitizeDomainInput('')).toBe('');
  });

  it('should handle already clean domain', () => {
    expect(sanitizeDomainInput('example.com')).toBe('example.com');
  });

  it('should handle complex input', () => {
    expect(sanitizeDomainInput('https://blog.example.com:8080/path?query=1')).toBe('blog.example.com');
  });
});

describe('parseDomain', () => {
  describe('root domains', () => {
    it('should parse simple root domain', () => {
      const result = parseDomain('example.com');
      expect(result).toEqual({
        fqdn: 'example.com',
        rootDomain: 'example.com',
        subdomain: null,
        isSubdomain: false,
        tld: 'com',
      });
    });

    it('should parse .org domain', () => {
      const result = parseDomain('example.org');
      expect(result).toEqual({
        fqdn: 'example.org',
        rootDomain: 'example.org',
        subdomain: null,
        isSubdomain: false,
        tld: 'org',
      });
    });

    it('should parse .net domain', () => {
      const result = parseDomain('example.net');
      expect(result).toEqual({
        fqdn: 'example.net',
        rootDomain: 'example.net',
        subdomain: null,
        isSubdomain: false,
        tld: 'net',
      });
    });
  });

  describe('subdomains', () => {
    it('should parse www subdomain', () => {
      const result = parseDomain('www.example.com');
      expect(result).toEqual({
        fqdn: 'www.example.com',
        rootDomain: 'example.com',
        subdomain: 'www',
        isSubdomain: true,
        tld: 'com',
      });
    });

    it('should parse blog subdomain', () => {
      const result = parseDomain('blog.example.com');
      expect(result).toEqual({
        fqdn: 'blog.example.com',
        rootDomain: 'example.com',
        subdomain: 'blog',
        isSubdomain: true,
        tld: 'com',
      });
    });

    it('should parse multi-level subdomain', () => {
      const result = parseDomain('api.staging.example.com');
      expect(result).toEqual({
        fqdn: 'api.staging.example.com',
        rootDomain: 'example.com',
        subdomain: 'api.staging',
        isSubdomain: true,
        tld: 'com',
      });
    });

    it('should parse deeply nested subdomain', () => {
      const result = parseDomain('a.b.c.d.example.com');
      expect(result).toEqual({
        fqdn: 'a.b.c.d.example.com',
        rootDomain: 'example.com',
        subdomain: 'a.b.c.d',
        isSubdomain: true,
        tld: 'com',
      });
    });
  });

  describe('two-part TLDs', () => {
    it('should parse co.uk domain', () => {
      const result = parseDomain('example.co.uk');
      expect(result).toEqual({
        fqdn: 'example.co.uk',
        rootDomain: 'example.co.uk',
        subdomain: null,
        isSubdomain: false,
        tld: 'co.uk',
      });
    });

    it('should parse www.example.co.uk', () => {
      const result = parseDomain('www.example.co.uk');
      expect(result).toEqual({
        fqdn: 'www.example.co.uk',
        rootDomain: 'example.co.uk',
        subdomain: 'www',
        isSubdomain: true,
        tld: 'co.uk',
      });
    });

    it('should parse com.au domain', () => {
      const result = parseDomain('example.com.au');
      expect(result).toEqual({
        fqdn: 'example.com.au',
        rootDomain: 'example.com.au',
        subdomain: null,
        isSubdomain: false,
        tld: 'com.au',
      });
    });

    it('should parse co.nz domain', () => {
      const result = parseDomain('example.co.nz');
      expect(result).toEqual({
        fqdn: 'example.co.nz',
        rootDomain: 'example.co.nz',
        subdomain: null,
        isSubdomain: false,
        tld: 'co.nz',
      });
    });

    it('should parse subdomain with two-part TLD', () => {
      const result = parseDomain('blog.example.co.uk');
      expect(result).toEqual({
        fqdn: 'blog.example.co.uk',
        rootDomain: 'example.co.uk',
        subdomain: 'blog',
        isSubdomain: true,
        tld: 'co.uk',
      });
    });

    it('should parse multi-level subdomain with two-part TLD', () => {
      const result = parseDomain('api.staging.example.com.au');
      expect(result).toEqual({
        fqdn: 'api.staging.example.com.au',
        rootDomain: 'example.com.au',
        subdomain: 'api.staging',
        isSubdomain: true,
        tld: 'com.au',
      });
    });
  });

  describe('protocol and path handling', () => {
    it('should sanitize protocol before parsing', () => {
      const result = parseDomain('https://example.com');
      expect(result?.fqdn).toBe('example.com');
    });

    it('should sanitize path before parsing', () => {
      const result = parseDomain('example.com/path');
      expect(result?.fqdn).toBe('example.com');
    });

    it('should sanitize port before parsing', () => {
      const result = parseDomain('example.com:8080');
      expect(result?.fqdn).toBe('example.com');
    });
  });

  describe('invalid domains', () => {
    it('should return null for single part', () => {
      const result = parseDomain('example');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseDomain('');
      expect(result).toBeNull();
    });

    it('should return null for invalid two-part TLD with only 2 parts', () => {
      const result = parseDomain('co.uk');
      expect(result).toBeNull();
    });
  });
});

describe('validateDomain', () => {
  describe('valid domains', () => {
    it('should validate simple root domain', () => {
      const result = validateDomain('example.com');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.parsed).toBeDefined();
      expect(result.parsed?.fqdn).toBe('example.com');
    });

    it('should validate subdomain', () => {
      const result = validateDomain('www.example.com');
      expect(result.isValid).toBe(true);
      expect(result.parsed?.isSubdomain).toBe(true);
    });

    it('should validate domain with protocol', () => {
      const result = validateDomain('https://example.com');
      expect(result.isValid).toBe(true);
      expect(result.parsed?.fqdn).toBe('example.com');
    });

    it('should validate domain with path', () => {
      const result = validateDomain('example.com/path');
      expect(result.isValid).toBe(true);
      expect(result.parsed?.fqdn).toBe('example.com');
    });

    it('should validate two-part TLD', () => {
      const result = validateDomain('example.co.uk');
      expect(result.isValid).toBe(true);
      expect(result.parsed?.tld).toBe('co.uk');
    });
  });

  describe('invalid domains', () => {
    it('should reject empty string', () => {
      const result = validateDomain('');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Domain is required');
    });

    it('should reject whitespace only', () => {
      const result = validateDomain('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Domain is required');
    });

    it('should reject single word', () => {
      const result = validateDomain('example');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid domain format');
    });

    it('should reject domain with spaces', () => {
      const result = validateDomain('example .com');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid domain format');
    });

    it('should reject domain with invalid characters', () => {
      const result = validateDomain('example@#$.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid domain format');
    });
  });
});

describe('isCustomerDomain', () => {
  const mockCustomerDomains = [
    { domain: 'example.com' },
    { domain: 'another.com' },
    { name: 'named-domain.org' },
  ];

  describe('exact matches', () => {
    it('should return true for exact domain match', () => {
      expect(isCustomerDomain('example.com', mockCustomerDomains)).toBe(true);
    });

    it('should return true for exact match with name field', () => {
      expect(isCustomerDomain('named-domain.org', mockCustomerDomains)).toBe(true);
    });

    it('should return false for non-matching domain', () => {
      expect(isCustomerDomain('notowned.com', mockCustomerDomains)).toBe(false);
    });
  });

  describe('subdomain matching', () => {
    it('should return true for subdomain of owned domain', () => {
      expect(isCustomerDomain('blog.example.com', mockCustomerDomains)).toBe(true);
    });

    it('should return true for www subdomain of owned domain', () => {
      expect(isCustomerDomain('www.example.com', mockCustomerDomains)).toBe(true);
    });

    it('should return true for multi-level subdomain of owned domain', () => {
      expect(isCustomerDomain('api.staging.example.com', mockCustomerDomains)).toBe(true);
    });

    it('should return false for subdomain of non-owned domain', () => {
      expect(isCustomerDomain('blog.notowned.com', mockCustomerDomains)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return false for invalid domain', () => {
      expect(isCustomerDomain('invalid', mockCustomerDomains)).toBe(false);
    });

    it('should return false with empty customer domains', () => {
      expect(isCustomerDomain('example.com', [])).toBe(false);
    });

    it('should handle customer domains with both domain and name fields', () => {
      const domains = [{ domain: 'example.com', name: 'ignored.com' }];
      expect(isCustomerDomain('example.com', domains)).toBe(true);
      expect(isCustomerDomain('ignored.com', domains)).toBe(false);
    });

    it('should match customer and app FQDNs case-insensitively', () => {
      const domains = [{ domain: 'Example.COM' }];
      expect(isCustomerDomain('example.com', domains)).toBe(true);
      expect(isCustomerDomain('EXAMPLE.COM', domains)).toBe(true);
    });
  });
});

describe('getDnsRecords', () => {
  const anycastIp = '192.0.2.1';

  describe('root domains', () => {
    it('should return A and CNAME records for root domain', () => {
      const result = getDnsRecords('example.com', anycastIp);
      expect(result.aRecord).toEqual({
        type: 'A',
        name: '@',
        value: anycastIp,
        ttl: 3600,
      });
      expect(result.cnameRecord).toEqual({
        type: 'CNAME',
        name: 'www',
        value: 'example.com',
        ttl: 3600,
      });
    });

    it('should return appropriate records for .org domain', () => {
      const result = getDnsRecords('example.org', anycastIp);
      expect(result.aRecord.name).toBe('@');
      expect(result.cnameRecord?.value).toBe('example.org');
    });

    it('should return appropriate records for two-part TLD', () => {
      const result = getDnsRecords('example.co.uk', anycastIp);
      expect(result.aRecord.name).toBe('@');
      expect(result.cnameRecord?.value).toBe('example.co.uk');
    });
  });

  describe('subdomains', () => {
    it('should return only A record for subdomain', () => {
      const result = getDnsRecords('blog.example.com', anycastIp);
      expect(result.aRecord).toEqual({
        type: 'A',
        name: 'blog',
        value: anycastIp,
        ttl: 3600,
      });
      expect(result.cnameRecord).toBeNull();
    });

    it('should return only A record for www subdomain', () => {
      const result = getDnsRecords('www.example.com', anycastIp);
      expect(result.aRecord).toEqual({
        type: 'A',
        name: 'www',
        value: anycastIp,
        ttl: 3600,
      });
      expect(result.cnameRecord).toBeNull();
    });

    it('should return only A record for multi-level subdomain', () => {
      const result = getDnsRecords('api.staging.example.com', anycastIp);
      expect(result.aRecord).toEqual({
        type: 'A',
        name: 'api.staging',
        value: anycastIp,
        ttl: 3600,
      });
      expect(result.cnameRecord).toBeNull();
    });
  });

  describe('invalid domains', () => {
    it('should return fallback records for invalid domain', () => {
      const result = getDnsRecords('invalid', anycastIp);
      expect(result.aRecord).toEqual({
        type: 'A',
        name: '@',
        value: anycastIp,
        ttl: 3600,
      });
      expect(result.cnameRecord).toBeNull();
    });

    it('should handle empty domain gracefully', () => {
      const result = getDnsRecords('', anycastIp);
      expect(result.aRecord.name).toBe('@');
      expect(result.aRecord.value).toBe(anycastIp);
    });
  });

  describe('DNS record properties', () => {
    it('should use provided anycast IP', () => {
      const customIp = '198.51.100.1';
      const result = getDnsRecords('example.com', customIp);
      expect(result.aRecord.value).toBe(customIp);
    });

    it('should use 3600 seconds (1 hour) as TTL', () => {
      const result = getDnsRecords('example.com', anycastIp);
      expect(result.aRecord.ttl).toBe(3600);
      expect(result.cnameRecord?.ttl).toBe(3600);
    });

    it('should set correct record types', () => {
      const result = getDnsRecords('example.com', anycastIp);
      expect(result.aRecord.type).toBe('A');
      expect(result.cnameRecord?.type).toBe('CNAME');
    });
  });

  describe('DCV (certificate validation) records', () => {
    const certificateValidationCname = 'abc123.validation.secureserver.net';

    describe('root domains with DCV', () => {
      it('should return _acme-challenge DCV record for root domain', () => {
        const result = getDnsRecords('example.com', anycastIp, certificateValidationCname);
        expect(result.dcvRecord).toEqual({
          type: 'CNAME',
          name: '_acme-challenge',
          value: certificateValidationCname,
          ttl: 3600,
        });
      });

      it('should return _acme-challenge DCV record for .org domain', () => {
        const result = getDnsRecords('example.org', anycastIp, certificateValidationCname);
        expect(result.dcvRecord?.name).toBe('_acme-challenge');
        expect(result.dcvRecord?.value).toBe(certificateValidationCname);
      });

      it('should return _acme-challenge DCV record for two-part TLD', () => {
        const result = getDnsRecords('example.co.uk', anycastIp, certificateValidationCname);
        expect(result.dcvRecord?.name).toBe('_acme-challenge');
        expect(result.dcvRecord?.value).toBe(certificateValidationCname);
      });
    });

    describe('subdomains with DCV', () => {
      it('should return _acme-challenge.subdomain for single-level subdomain', () => {
        const result = getDnsRecords('blog.example.com', anycastIp, certificateValidationCname);
        expect(result.dcvRecord).toEqual({
          type: 'CNAME',
          name: '_acme-challenge.blog',
          value: certificateValidationCname,
          ttl: 3600,
        });
      });

      it('should return _acme-challenge.subdomain for www subdomain', () => {
        const result = getDnsRecords('www.example.com', anycastIp, certificateValidationCname);
        expect(result.dcvRecord).toEqual({
          type: 'CNAME',
          name: '_acme-challenge.www',
          value: certificateValidationCname,
          ttl: 3600,
        });
      });

      it('should return _acme-challenge.subdomain for multi-level subdomain', () => {
        const result = getDnsRecords('api.staging.example.com', anycastIp, certificateValidationCname);
        expect(result.dcvRecord).toEqual({
          type: 'CNAME',
          name: '_acme-challenge.api.staging',
          value: certificateValidationCname,
          ttl: 3600,
        });
      });

      it('should return _acme-challenge.subdomain for deeply nested subdomain', () => {
        const result = getDnsRecords('a.b.c.example.com', anycastIp, certificateValidationCname);
        expect(result.dcvRecord).toEqual({
          type: 'CNAME',
          name: '_acme-challenge.a.b.c',
          value: certificateValidationCname,
          ttl: 3600,
        });
      });

      it('should return _acme-challenge.subdomain for subdomain with two-part TLD', () => {
        const result = getDnsRecords('blog.example.co.uk', anycastIp, certificateValidationCname);
        expect(result.dcvRecord).toEqual({
          type: 'CNAME',
          name: '_acme-challenge.blog',
          value: certificateValidationCname,
          ttl: 3600,
        });
      });
    });

    describe('domains without DCV', () => {
      it('should return null DCV record when certificateValidationCname not provided for root domain', () => {
        const result = getDnsRecords('example.com', anycastIp);
        expect(result.dcvRecord).toBeNull();
      });

      it('should return null DCV record when certificateValidationCname not provided for subdomain', () => {
        const result = getDnsRecords('blog.example.com', anycastIp);
        expect(result.dcvRecord).toBeNull();
      });

      it('should return null DCV record when certificateValidationCname is undefined', () => {
        const result = getDnsRecords('example.com', anycastIp, undefined);
        expect(result.dcvRecord).toBeNull();
      });

      it('should return null DCV record when certificateValidationCname is empty string', () => {
        const result = getDnsRecords('example.com', anycastIp, '');
        expect(result.dcvRecord).toBeNull();
      });
    });
  });

});


describe('isAiroSubdomain', () => {
  it('should return true for .airoapp.ai subdomain', () => {
    expect(isAiroSubdomain('https://myapp.airoapp.ai')).toBe(true);
  });

  it('should return true for .test-airoapp.ai subdomain', () => {
    expect(isAiroSubdomain('https://myapp.preview.c4.test-airoapp.ai')).toBe(true);
  });

  it('should return true for .dev-airoapp.ai subdomain', () => {
    expect(isAiroSubdomain('https://myapp.dev-airoapp.ai')).toBe(true);
  });

  it('should return false for custom domain', () => {
    expect(isAiroSubdomain('https://custom.example.com')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isAiroSubdomain('')).toBe(false);
  });

  it('should return false for invalid URL', () => {
    expect(isAiroSubdomain('not-a-url')).toBe(false);
  });
});

describe('isBlockedAiroDomain', () => {
  describe('blocks airoapp.ai variants', () => {
    it('should block .airoapp.ai domain', () => {
      expect(isBlockedAiroDomain('someapp.airoapp.ai')).toBe(true);
    });

    it('should block .test-airoapp.ai domain', () => {
      expect(isBlockedAiroDomain('rjj3iakxkw.c4.test-airoapp.ai')).toBe(true);
    });

    it('should block .dev-airoapp.ai domain', () => {
      expect(isBlockedAiroDomain('myapp.dev-airoapp.ai')).toBe(true);
    });

    it('should block deeply nested airoapp.ai subdomains', () => {
      expect(isBlockedAiroDomain('app.preview.c4.airoapp.ai')).toBe(true);
    });

    it('should block own app prefix domain', () => {
      expect(isBlockedAiroDomain('97qcm6p74m.c37.airoapp.ai')).toBe(true);
    });

    it('should block domain with trailing dot', () => {
      expect(isBlockedAiroDomain('97qcm6p74m.c37.airoapp.ai.')).toBe(true);
    });

    it('should block domain with multiple trailing dots', () => {
      expect(isBlockedAiroDomain('someapp.airoapp.ai...')).toBe(true);
    });
  });

  describe('allows non-airoapp.ai domains', () => {
    it('should allow regular custom domain', () => {
      expect(isBlockedAiroDomain('mybusiness.com')).toBe(false);
    });

    it('should allow subdomain of custom domain', () => {
      expect(isBlockedAiroDomain('shop.mybusiness.com')).toBe(false);
    });

    it('should allow empty string', () => {
      expect(isBlockedAiroDomain('')).toBe(false);
    });
  });

  describe('case insensitivity', () => {
    it('should block uppercase airoapp.ai domain', () => {
      expect(isBlockedAiroDomain('SOMEAPP.AIROAPP.AI')).toBe(true);
    });

    it('should block own prefix domain in uppercase', () => {
      expect(isBlockedAiroDomain('97QCM6P74M.C37.AIROAPP.AI')).toBe(true);
    });
  });
});

function makeSiteDomain(partial: Pick<SiteDomain, 'fqdn' | 'domainType' | 'status'>): SiteDomain {
  return {
    fqdn: partial.fqdn,
    isPrimary: false,
    domainType: partial.domainType,
    prefix: '',
    status: partial.status,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  };
}

describe('resolveSiteFqdn', () => {
  it('should prefer custom domain over prefix domain', () => {
    expect(resolveSiteFqdn({
      domains: [
        makeSiteDomain({ fqdn: 'prefix.airoapp.ai', domainType: DomainType.PREFIX, status: DomainStatus.ACTIVE }),
        makeSiteDomain({ fqdn: 'custom.example.com', domainType: DomainType.CUSTOM, status: DomainStatus.ACTIVE }),
      ],
      published_url: 'https://fallback.com',
    })).toBe('https://custom.example.com');
  });

  it('should treat domain without domainType as custom and prefer it over prefix domain', () => {
    expect(resolveSiteFqdn({
      domains: [
        makeSiteDomain({ fqdn: 'prefix.airoapp.ai', domainType: DomainType.PREFIX, status: DomainStatus.ACTIVE }),
        makeSiteDomain({ fqdn: 'custom-no-type.example.com', domainType: null, status: DomainStatus.ACTIVE }),
      ],
      published_url: 'https://fallback.com',
    })).toBe('https://custom-no-type.example.com');
  });

  it('should fall back to prefix domain when no custom domain', () => {
    expect(resolveSiteFqdn({
      domains: [
        makeSiteDomain({ fqdn: 'prefix.airoapp.ai', domainType: DomainType.PREFIX, status: DomainStatus.ACTIVE }),
      ],
      published_url: 'https://fallback.com',
    })).toBe('https://prefix.airoapp.ai');
  });

  it('should use active prefix when custom domain is not active (e.g. error)', () => {
    expect(resolveSiteFqdn({
      published_url: 'https://wx8i3fw9rv.c37.airoapp.ai',
      domains: [
        makeSiteDomain({ fqdn: 'jadilah.c37.airoapp.ai', domainType: DomainType.PREFIX, status: DomainStatus.ACTIVE }),
        makeSiteDomain({ fqdn: 'jadilah.shop', domainType: null, status: DomainStatus.ERROR }),
      ],
    })).toBe('https://jadilah.c37.airoapp.ai');
  });

  it('should ignore pending custom domain and use active prefix', () => {
    expect(resolveSiteFqdn({
      published_url: 'https://wx8i3fw9rv.c37.airoapp.ai',
      domains: [
        makeSiteDomain({ fqdn: 'prefix.c37.airoapp.ai', domainType: DomainType.PREFIX, status: DomainStatus.ACTIVE }),
        makeSiteDomain({ fqdn: 'shop.example.com', domainType: null, status: DomainStatus.PENDING }),
      ],
    })).toBe('https://prefix.c37.airoapp.ai');
  });

  it('should fall back to published_url when no domain rows are active', () => {
    expect(resolveSiteFqdn({
      published_url: 'https://wx8i3fw9rv.c37.airoapp.ai',
      domains: [
        makeSiteDomain({ fqdn: 'prefix.c37.airoapp.ai', domainType: DomainType.PREFIX, status: DomainStatus.ERROR }),
        makeSiteDomain({ fqdn: 'shop.example.com', domainType: null, status: DomainStatus.PENDING }),
      ],
    })).toBe('https://wx8i3fw9rv.c37.airoapp.ai');
  });

  it('should fall back to published_url when no domains', () => {
    expect(resolveSiteFqdn({
      domains: [],
      published_url: 'https://published.example.com',
    })).toBe('https://published.example.com');
  });

  it('should prepend https:// when protocol is missing', () => {
    expect(resolveSiteFqdn({
      published_url: 'myapp.airoapp.ai',
    })).toBe('https://myapp.airoapp.ai');
  });

  it('should preserve existing https:// protocol', () => {
    expect(resolveSiteFqdn({
      published_url: 'https://myapp.airoapp.ai',
    })).toBe('https://myapp.airoapp.ai');
  });

  it('should preserve existing http:// protocol', () => {
    expect(resolveSiteFqdn({
      published_url: 'http://myapp.airoapp.ai',
    })).toBe('http://myapp.airoapp.ai');
  });

  it('should return empty string for null site', () => {
    expect(resolveSiteFqdn(null)).toBe('');
  });

  it('should return empty string for undefined site', () => {
    expect(resolveSiteFqdn(undefined)).toBe('');
  });

  it('should return empty string when all fields are empty', () => {
    expect(resolveSiteFqdn({
      domains: [],
      published_url: '',
    })).toBe('');
  });

  it('should return empty string when domains and published_url are undefined', () => {
    expect(resolveSiteFqdn({
      domains: undefined,
      published_url: undefined,
    })).toBe('');
  });
});

describe('findCustomerDomain', () => {
  const mockCustomerDomains = [
    { domain: 'example.com', hasInternalNameservers: true, nameservers: ['ns1.domaincontrol.com'] },
    { domain: 'another.com', hasInternalNameservers: false, nameservers: ['ns1.cloudflare.com'] },
    { name: 'named-domain.org', hasInternalNameservers: true },
  ];

  describe('exact matches', () => {
    it('should return domain object for exact domain match', () => {
      const result = findCustomerDomain('example.com', mockCustomerDomains);
      expect(result).toEqual(mockCustomerDomains[0]);
    });

    it('should return domain object for exact match with name field', () => {
      const result = findCustomerDomain('named-domain.org', mockCustomerDomains);
      expect(result).toEqual(mockCustomerDomains[2]);
    });

    it('should return null for non-matching domain', () => {
      const result = findCustomerDomain('notowned.com', mockCustomerDomains);
      expect(result).toBeNull();
    });
  });

  describe('subdomain matching', () => {
    it('should return root domain object for subdomain', () => {
      const result = findCustomerDomain('blog.example.com', mockCustomerDomains);
      expect(result).toEqual(mockCustomerDomains[0]);
    });

    it('should return root domain object for www subdomain', () => {
      const result = findCustomerDomain('www.example.com', mockCustomerDomains);
      expect(result).toEqual(mockCustomerDomains[0]);
    });

    it('should return root domain object for multi-level subdomain', () => {
      const result = findCustomerDomain('api.staging.example.com', mockCustomerDomains);
      expect(result).toEqual(mockCustomerDomains[0]);
    });

    it('should return null for subdomain of non-owned domain', () => {
      const result = findCustomerDomain('blog.notowned.com', mockCustomerDomains);
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should return null for invalid domain', () => {
      const result = findCustomerDomain('invalid', mockCustomerDomains);
      expect(result).toBeNull();
    });

    it('should return null with empty customer domains', () => {
      const result = findCustomerDomain('example.com', []);
      expect(result).toBeNull();
    });

    it('should preserve all properties from matched domain', () => {
      const result = findCustomerDomain('example.com', mockCustomerDomains);
      expect(result?.hasInternalNameservers).toBe(true);
      expect(result?.nameservers).toEqual(['ns1.domaincontrol.com']);
    });
  });

  describe('internationalDisplayName fallback', () => {
    it('should match on internationalDisplayName when domain and name are missing', () => {
      const domains = [{ internationalDisplayName: 'münchen.de' }];
      const result = findCustomerDomain('münchen.de', domains);
      expect(result).toEqual(domains[0]);
    });
  });

  describe('case insensitivity', () => {
    it('should match when customer list casing differs from app FQDN', () => {
      const domains = [{ domain: 'Example.COM' }];
      const result = findCustomerDomain('example.com', domains);
      expect(result).toEqual(domains[0]);
    });
  });
});

describe('normalizeFqdn', () => {
  it('should trim and lowercase', () => {
    expect(normalizeFqdn('  Example.COM  ')).toBe('example.com');
  });
});

describe('dedupeSiteDomainsByFqdn', () => {
  it('should return empty array when input is empty', () => {
    expect(dedupeSiteDomainsByFqdn([])).toEqual([]);
  });

  it('should return single row unchanged', () => {
    const domains = [{ fqdn: 'Example.COM', status: 'active' }];
    const result = dedupeSiteDomainsByFqdn(domains);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(domains[0]);
  });

  it('should collapse rows that differ only by casing', () => {
    const domains = [
      { fqdn: 'Example.COM', status: 'pending' },
      { fqdn: 'example.com', status: 'active' },
    ];
    const result = dedupeSiteDomainsByFqdn(domains);
    expect(result).toHaveLength(1);
    expect(result[0]?.fqdn).toBe('example.com');
    expect(result[0]?.status).toBe('active');
  });

  it('should prefer higher-status row before canonical casing', () => {
    const domains = [
      { fqdn: 'example.com', status: 'pending' },
      { fqdn: 'Example.COM', status: 'active' },
    ];
    const result = dedupeSiteDomainsByFqdn(domains);
    expect(result).toHaveLength(1);
    expect(result[0]?.fqdn).toBe('Example.COM');
    expect(result[0]?.status).toBe('active');
  });

  it('should keep first row when both rows are lowercase with equal status rank', () => {
    const domains = [
      { fqdn: 'example.com', status: 'inactive', source: 'first' },
      { fqdn: 'example.com', status: 'failed', source: 'second' },
    ];
    const result = dedupeSiteDomainsByFqdn(domains);
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('first');
  });

  it('should keep first row when both rows are mixed-case with equal status rank', () => {
    const domains = [
      { fqdn: 'Example.COM', status: 'inactive', source: 'first' },
      { fqdn: 'EXAMPLE.com', status: 'failed', source: 'second' },
    ];
    const result = dedupeSiteDomainsByFqdn(domains);
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('first');
    expect(result[0]?.fqdn).toBe('Example.COM');
  });
});

describe('hasExternalNameservers', () => {
  describe('using hasInternalNameservers flag', () => {
    it('should return false when hasInternalNameservers is true and nameservers contain domaincontrol.com', () => {
      expect(hasExternalNameservers(true, ['ns1.domaincontrol.com', 'ns2.domaincontrol.com'])).toBe(false);
    });

    it('should return true when hasInternalNameservers is false', () => {
      expect(hasExternalNameservers(false, ['ns1.domaincontrol.com'])).toBe(true);
    });

    it('should return true when hasInternalNameservers is false even with GoDaddy nameservers', () => {
      expect(hasExternalNameservers(false, ['ns1.domaincontrol.com', 'ns2.domaincontrol.com'])).toBe(true);
    });
  });

  describe('nameserver pattern matching', () => {
    it('should return true when nameservers do not contain domaincontrol.com', () => {
      expect(hasExternalNameservers(undefined, ['ns1.cloudflare.com', 'ns2.cloudflare.com'])).toBe(true);
    });

    it('should return false when nameservers contain domaincontrol.com (no flag)', () => {
      expect(hasExternalNameservers(undefined, ['ns31.domaincontrol.com', 'ns32.domaincontrol.com'])).toBe(false);
    });

    it('should return true for mixed nameservers (requires ALL to be GoDaddy)', () => {
      expect(hasExternalNameservers(undefined, ['ns1.cloudflare.com', 'ns31.domaincontrol.com'])).toBe(true);
    });

    it('should return false only when ALL nameservers are GoDaddy', () => {
      expect(hasExternalNameservers(undefined, ['ns31.domaincontrol.com', 'ns32.domaincontrol.com'])).toBe(false);
    });

    it('should be case-insensitive for nameserver matching', () => {
      expect(hasExternalNameservers(undefined, ['NS1.DOMAINCONTROL.COM'])).toBe(false);
    });

    it('should handle various GoDaddy nameserver patterns', () => {
      expect(hasExternalNameservers(undefined, ['pdns13.domaincontrol.com'])).toBe(false);
      expect(hasExternalNameservers(undefined, ['ns31.domaincontrol.com'])).toBe(false);
    });
  });

  describe('mismatch scenarios (belt and suspenders)', () => {
    it('should return true when flag is true but nameservers are external', () => {
      // Flag says internal but nameservers say external - trust the nameservers
      expect(hasExternalNameservers(true, ['ns1.cloudflare.com', 'ns2.cloudflare.com'])).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should return false when both flag and nameservers are undefined', () => {
      expect(hasExternalNameservers(undefined, undefined)).toBe(false);
    });

    it('should return false when flag is undefined and nameservers is empty array', () => {
      expect(hasExternalNameservers(undefined, [])).toBe(false);
    });

    it('should return false when flag is true and nameservers is undefined', () => {
      expect(hasExternalNameservers(true, undefined)).toBe(false);
    });

    it('should return true when flag is false and nameservers is undefined', () => {
      expect(hasExternalNameservers(false, undefined)).toBe(true);
    });
  });

  describe('real-world nameserver examples', () => {
    it('should detect Cloudflare nameservers as external', () => {
      expect(hasExternalNameservers(false, ['bart.ns.cloudflare.com', 'lisa.ns.cloudflare.com'])).toBe(true);
    });

    it('should detect AWS Route53 nameservers as external', () => {
      expect(hasExternalNameservers(false, ['ns-123.awsdns-45.com', 'ns-678.awsdns-90.net'])).toBe(true);
    });

    it('should detect Google Cloud DNS nameservers as external', () => {
      expect(hasExternalNameservers(false, ['ns-cloud-a1.googledomains.com'])).toBe(true);
    });

    it('should recognize standard GoDaddy nameservers', () => {
      expect(hasExternalNameservers(true, ['ns31.domaincontrol.com', 'ns32.domaincontrol.com'])).toBe(false);
      expect(hasExternalNameservers(true, ['pdns13.domaincontrol.com', 'pdns14.domaincontrol.com'])).toBe(false);
    });
  });

  describe('spoofing prevention (strict suffix matching)', () => {
    it('should detect fake-domaincontrol.com as external', () => {
      expect(hasExternalNameservers(undefined, ['fake-domaincontrol.com'])).toBe(true);
    });

    it('should detect domaincontrol.com.evil.com as external', () => {
      expect(hasExternalNameservers(undefined, ['domaincontrol.com.evil.com'])).toBe(true);
    });

    it('should detect ns1-domaincontrol.com as external', () => {
      expect(hasExternalNameservers(undefined, ['ns1-domaincontrol.com'])).toBe(true);
    });

    it('should detect mydomaincontrol.com as external', () => {
      expect(hasExternalNameservers(undefined, ['mydomaincontrol.com'])).toBe(true);
    });

    it('should accept exact domaincontrol.com as valid', () => {
      expect(hasExternalNameservers(undefined, ['domaincontrol.com'])).toBe(false);
    });

    it('should only accept proper subdomains of domaincontrol.com', () => {
      // Valid: ends with .domaincontrol.com
      expect(hasExternalNameservers(undefined, ['ns31.domaincontrol.com'])).toBe(false);
      expect(hasExternalNameservers(undefined, ['pdns13.domaincontrol.com'])).toBe(false);

      // Invalid: doesn't end with .domaincontrol.com
      expect(hasExternalNameservers(undefined, ['notdomaincontrol.com'])).toBe(true);
    });
  });
});

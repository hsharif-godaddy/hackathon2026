import { describe, expect, it } from 'vitest';

import {
  getDnsRecords,
  isAiroSubdomain,
  isCustomerDomain,
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

describe('resolveSiteFqdn', () => {
  it('should prefer custom domain over prefix domain', () => {
    expect(resolveSiteFqdn({
      domains: [
        { fqdn: 'prefix.airoapp.ai', domainType: 'prefix' },
        { fqdn: 'custom.example.com', domainType: 'custom' },
      ],
      published_url: 'https://fallback.com',
    })).toBe('https://custom.example.com');
  });

  it('should treat domain without domainType as custom and prefer it over prefix domain', () => {
    expect(resolveSiteFqdn({
      domains: [
        { fqdn: 'prefix.airoapp.ai', domainType: 'prefix' },
        { fqdn: 'custom-no-type.example.com' },
      ],
      published_url: 'https://fallback.com',
    })).toBe('https://custom-no-type.example.com');
  });
  it('should fall back to prefix domain when no custom domain', () => {
    expect(resolveSiteFqdn({
      domains: [
        { fqdn: 'prefix.airoapp.ai', domainType: 'prefix' },
      ],
      published_url: 'https://fallback.com',
    })).toBe('https://prefix.airoapp.ai');
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

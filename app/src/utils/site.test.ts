import { describe, expect, it } from 'vitest';

import { DomainStatus, DomainType, LifecycleState, SiteStatus } from '@/lib/control-plane/types';
import { canAccessDomainManagement, hasBeenPublished, hasCustomDomainAttachments, isPreviewHibernated, isSiteSuspended } from './site';

describe('hasBeenPublished', () => {
  describe('with publish variant', () => {
    it('should return true when variants includes "publish"', () => {
      const site = { variants: ['preview', 'publish'] };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should return true when only publish variant exists', () => {
      const site = { variants: ['publish'] };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should return true when publish is first in variants array', () => {
      const site = { variants: ['publish', 'preview'] };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should return true when publish is in middle of variants array', () => {
      const site = { variants: ['preview', 'publish', 'staging'] };
      expect(hasBeenPublished(site)).toBe(true);
    });
  });

  describe('without publish variant', () => {
    it('should return false when variants only includes "preview"', () => {
      const site = { variants: ['preview'] };
      expect(hasBeenPublished(site)).toBe(false);
    });

    it('should return false when variants is empty array', () => {
      const site = { variants: [] as string[] };
      expect(hasBeenPublished(site)).toBe(false);
    });

    it('should return false when variants has other values but not publish', () => {
      const site = { variants: ['preview', 'staging', 'development'] };
      expect(hasBeenPublished(site)).toBe(false);
    });
  });

  describe('null and undefined handling', () => {
    it('should return false when site is null', () => {
      expect(hasBeenPublished(null)).toBe(false);
    });

    it('should return false when site is undefined', () => {
      expect(hasBeenPublished(undefined)).toBe(false);
    });

    it('should return false when variants is undefined', () => {
      const site = { variants: undefined };
      expect(hasBeenPublished(site as any)).toBe(false);
    });

    it('should return false when variants is null', () => {
      const site = { variants: null };
      expect(hasBeenPublished(site as any)).toBe(false);
    });

    it('should return false when site object is empty', () => {
      const site = {};
      expect(hasBeenPublished(site as any)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should be case-sensitive for "publish"', () => {
      expect(hasBeenPublished({ variants: ['Publish'] })).toBe(false);
      expect(hasBeenPublished({ variants: ['PUBLISH'] })).toBe(false);
    });

    it('should not match partial strings', () => {
      const site = { variants: ['published', 'pre-publish', 'publishable'] };
      expect(hasBeenPublished(site)).toBe(false);
    });

    it('should handle duplicate "publish" entries', () => {
      const site = { variants: ['publish', 'preview', 'publish'] };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should handle variants with whitespace', () => {
      const site = { variants: [' publish ', 'preview'] };
      expect(hasBeenPublished(site)).toBe(false);
    });

    it('should handle empty strings in variants', () => {
      const site = { variants: ['', 'publish', ''] };
      expect(hasBeenPublished(site)).toBe(true);
    });
  });

  describe('type compatibility', () => {
    it('should work with minimal site object', () => {
      const site = { variants: ['publish'] };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should work with full SiteInfo-like object', () => {
      const site = {
        id: 'site-123',
        name: 'My Site',
        variants: ['preview', 'publish'],
        createdAt: new Date(),
      };
      expect(hasBeenPublished(site)).toBe(true);
    });
  });

  describe('variantsWithLifecycle publish status', () => {
    it('should return true when publish lifecycle status is active', () => {
      const site = {
        variantsWithLifecycle: [{ variant: 'publish', status: 'active' }],
      };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should return true when publish lifecycle status is provisioning', () => {
      const site = {
        variantsWithLifecycle: [{ variant: 'publish', status: 'provisioning' }],
      };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should return false when variantsWithLifecycle has no publish entry even if variants includes publish', () => {
      const site = {
        variantsWithLifecycle: [{ variant: 'preview', status: 'active' }],
        variants: ['preview', 'publish'],
      };
      expect(hasBeenPublished(site)).toBe(false);
    });

    it('should return false when publish lifecycle is pending even if variants includes publish', () => {
      const site = {
        variantsWithLifecycle: [
          { variant: 'preview', status: 'active' },
          { variant: 'publish', status: 'pending' },
        ],
        variants: ['preview', 'publish'],
      };
      expect(hasBeenPublished(site)).toBe(false);
    });

    it('should return false when publish lifecycle is pending and variants omits publish', () => {
      const site = {
        variantsWithLifecycle: [{ variant: 'publish', status: 'pending' }],
        variants: ['preview'],
      };
      expect(hasBeenPublished(site)).toBe(false);
    });
  });

  describe('boolean consistency', () => {
    it('should always return boolean', () => {
      expect(typeof hasBeenPublished({ variants: ['publish'] })).toBe('boolean');
      expect(typeof hasBeenPublished({ variants: [] })).toBe('boolean');
      expect(typeof hasBeenPublished(null)).toBe('boolean');
      expect(typeof hasBeenPublished(undefined)).toBe('boolean');
    });

    it('should return true or false, never truthy/falsy values', () => {
      const result1 = hasBeenPublished({ variants: ['publish'] });
      const result2 = hasBeenPublished({ variants: [] });

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result1).not.toBe(1);
      expect(result2).not.toBe(0);
    });
  });
});

describe('hasCustomDomainAttachments', () => {
  it('should return false when no domains', () => {
    expect(hasCustomDomainAttachments({ domains: [] })).toBe(false);
    expect(hasCustomDomainAttachments(null)).toBe(false);
  });

  it('should return false for prefix-only domains', () => {
    expect(
      hasCustomDomainAttachments({
        domains: [
          { domainType: DomainType.PREFIX, status: DomainStatus.ACTIVE, fqdn: 'x', isPrimary: false, prefix: '', createdAt: '', updatedAt: '' },
        ],
      })
    ).toBe(false);
  });

  it('should return true for active non-prefix domain', () => {
    expect(
      hasCustomDomainAttachments({
        domains: [
          { domainType: DomainType.CUSTOM, status: DomainStatus.ACTIVE, fqdn: 'example.com', isPrimary: false, prefix: '', createdAt: '', updatedAt: '' },
        ],
      })
    ).toBe(true);
  });

  it('should ignore domains in DELETING status', () => {
    expect(
      hasCustomDomainAttachments({
        domains: [
          { domainType: DomainType.CUSTOM, status: DomainStatus.DELETING, fqdn: 'example.com', isPrimary: false, prefix: '', createdAt: '', updatedAt: '' },
        ],
      })
    ).toBe(false);
  });
});

describe('isSiteSuspended', () => {
  it('should return true when status is suspended', () => {
    expect(isSiteSuspended({ status: SiteStatus.Suspended })).toBe(true);
  });

  it('should return false for other statuses', () => {
    expect(isSiteSuspended({ status: SiteStatus.Running })).toBe(false);
    expect(isSiteSuspended({ status: SiteStatus.Created })).toBe(false);
  });

  it('should return false when site is null or status missing', () => {
    expect(isSiteSuspended(null)).toBe(false);
    expect(isSiteSuspended(undefined)).toBe(false);
    expect(isSiteSuspended({})).toBe(false);
  });
});

describe('canAccessDomainManagement', () => {
  it('should be true when inactive publish but custom domain exists', () => {
    const site = {
      variantsWithLifecycle: [{ variant: 'publish', status: 'inactive' }],
      domains: [
        { domainType: DomainType.FQDN, status: DomainStatus.ACTIVE, fqdn: 'x.com', isPrimary: false, prefix: '', createdAt: '', updatedAt: '' },
      ],
    };
    expect(canAccessDomainManagement(site)).toBe(true);
  });

  it('should be false when unpublished and no custom domains', () => {
    const site = {
      variantsWithLifecycle: [{ variant: 'publish', status: 'inactive' }],
      domains: [],
    };
    expect(canAccessDomainManagement(site)).toBe(false);
  });
});

describe('isPreviewHibernated', () => {
  it('should return true when preview variant is paused', () => {
    const site = {
      variantsWithLifecycle: [
        {
          variant: 'preview',
          status: 'inactive',
          lifecycle: {
            lifecycleState: LifecycleState.PAUSED,
          },
        },
      ],
    };
    expect(isPreviewHibernated(site)).toBe(true);
  });

  it('should return true when preview variant is archived (cold hibernation)', () => {
    const site = {
      variantsWithLifecycle: [
        {
          variant: 'preview',
          status: 'inactive',
          lifecycle: {
            lifecycleState: LifecycleState.ARCHIVED,
          },
        },
      ],
    };
    expect(isPreviewHibernated(site)).toBe(true);
  });

  it('should return false when preview variant is running', () => {
    const site = {
      variantsWithLifecycle: [
        {
          variant: 'preview',
          status: 'active',
          lifecycle: {
            lifecycleState: LifecycleState.RUNNING,
          },
        },
      ],
    };
    expect(isPreviewHibernated(site)).toBe(false);
  });

  it('should return false when no variantsWithLifecycle', () => {
    expect(isPreviewHibernated({})).toBe(false);
    expect(isPreviewHibernated({ variantsWithLifecycle: [] })).toBe(false);
  });

  it('should return false when site is null or undefined', () => {
    expect(isPreviewHibernated(null)).toBe(false);
    expect(isPreviewHibernated(undefined)).toBe(false);
  });

  it('should return false when only publish variant exists', () => {
    const site = {
      variantsWithLifecycle: [
        {
          variant: 'publish',
          status: 'inactive',
          lifecycle: {
            lifecycleState: LifecycleState.PAUSED,
          },
        },
      ],
    };
    expect(isPreviewHibernated(site)).toBe(false);
  });

  it('should return false when preview variant has no lifecycle property', () => {
    const site = {
      variantsWithLifecycle: [
        {
          variant: 'preview',
          status: 'active',
        },
      ],
    };
    expect(isPreviewHibernated(site)).toBe(false);
  });
});

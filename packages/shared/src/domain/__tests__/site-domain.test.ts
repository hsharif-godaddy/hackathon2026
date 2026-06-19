import { describe, expect, it } from 'vitest'

import { fqdnIsConnectedOrProvisioningOnSite, getConnectedOrProvisioningDomain } from '../site-domain.js'

describe('fqdnIsConnectedOrProvisioningOnSite', () => {
  it('returns false for undefined domains', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(undefined, 'example.com')).toBe(false)
  })

  it('returns false for empty domain list', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite([], 'example.com')).toBe(false)
  })

  it('returns true for active domain — cannot re-attach', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'example.com', domainType: 'custom', status: 'active' }],
      'example.com',
    )).toBe(true)
  })

  it('returns true for pending domain — provisioning in progress', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'example.com', domainType: 'custom', status: 'pending' }],
      'example.com',
    )).toBe(true)
  })

  it('returns true for null status — transitional state', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'example.com', domainType: 'custom', status: null }],
      'example.com',
    )).toBe(true)
  })

  it('returns true for empty status — transitional state', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'example.com', domainType: 'custom', status: '' }],
      'example.com',
    )).toBe(true)
  })

  it('returns false for deleting domain — re-attach allowed during slow detach', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'example.com', domainType: 'custom', status: 'deleting' }],
      'example.com',
    )).toBe(false)
  })

  it('returns false for failed domain — re-attach allowed for retry', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'example.com', domainType: 'custom', status: 'failed' }],
      'example.com',
    )).toBe(false)
  })

  it('returns false for error domain — re-attach allowed for retry', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'example.com', domainType: 'custom', status: 'error' }],
      'example.com',
    )).toBe(false)
  })

  it('returns false for inactive domain', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'example.com', domainType: 'custom', status: 'inactive' }],
      'example.com',
    )).toBe(false)
  })

  it('returns false for prefix domain regardless of status', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'example.com', domainType: 'prefix', status: 'active' }],
      'example.com',
    )).toBe(false)
  })

  it('returns false when fqdn does not match', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'other.com', domainType: 'custom', status: 'active' }],
      'example.com',
    )).toBe(false)
  })

  it('matches fqdn case-insensitively', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'EXAMPLE.COM', domainType: 'custom', status: 'active' }],
      'example.com',
    )).toBe(true)
  })

  it('matches status case-insensitively', () => {
    expect(fqdnIsConnectedOrProvisioningOnSite(
      [{ fqdn: 'example.com', domainType: 'custom', status: 'ACTIVE' }],
      'example.com',
    )).toBe(true)
  })
})

describe('getConnectedOrProvisioningDomain', () => {
  it('returns undefined for undefined domains', () => {
    expect(getConnectedOrProvisioningDomain(undefined)).toBeUndefined()
  })

  it('returns undefined for empty list', () => {
    expect(getConnectedOrProvisioningDomain([])).toBeUndefined()
  })

  it('returns active domain', () => {
    const domain = { fqdn: 'example.com', domainType: 'custom', status: 'active' }
    expect(getConnectedOrProvisioningDomain([domain])).toBe(domain)
  })

  it('returns pending domain when no active present', () => {
    const domain = { fqdn: 'example.com', domainType: 'custom', status: 'pending' }
    expect(getConnectedOrProvisioningDomain([domain])).toBe(domain)
  })

  it('prefers active over pending when both are present', () => {
    const active = { fqdn: 'active.com', domainType: 'custom', status: 'active' }
    const pending = { fqdn: 'pending.com', domainType: 'custom', status: 'pending' }
    expect(getConnectedOrProvisioningDomain([pending, active])).toBe(active)
  })

  it('returns undefined for deleting domain — not considered connected', () => {
    expect(getConnectedOrProvisioningDomain(
      [{ fqdn: 'example.com', domainType: 'custom', status: 'deleting' }],
    )).toBeUndefined()
  })

  it('returns undefined for failed domain — not considered connected', () => {
    expect(getConnectedOrProvisioningDomain(
      [{ fqdn: 'example.com', domainType: 'custom', status: 'failed' }],
    )).toBeUndefined()
  })

  it('skips prefix domains', () => {
    expect(getConnectedOrProvisioningDomain(
      [{ fqdn: 'prefix.example.com', domainType: 'prefix', status: 'active' }],
    )).toBeUndefined()
  })

  it('skips prefix and returns the custom domain', () => {
    const custom = { fqdn: 'example.com', domainType: 'custom', status: 'active' }
    expect(getConnectedOrProvisioningDomain([
      { fqdn: 'prefix.example.com', domainType: 'prefix', status: 'active' },
      custom,
    ])).toBe(custom)
  })
})

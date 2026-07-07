import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { mockResolveGoDaddyApiBaseUrl } = vi.hoisted(() => ({
  mockResolveGoDaddyApiBaseUrl: vi.fn(),
}))

vi.mock('@/lib/mcp/godaddy-api', () => ({
  resolveGoDaddyApiBaseUrl: mockResolveGoDaddyApiBaseUrl,
}))

import { getCommerceReportingApiUrl } from '../commerce-reporting-config'

const ORIGINAL_ENV = { ...process.env }

describe('commerce-reporting-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.COMMERCE_REPORTING_API_URL
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  describe('#getCommerceReportingApiUrl', () => {
    it('returns the env override when COMMERCE_REPORTING_API_URL is set', function override() {
      process.env.COMMERCE_REPORTING_API_URL = 'https://custom.reporting.example.com/'

      expect(getCommerceReportingApiUrl()).toBe('https://custom.reporting.example.com')
    })

    it('maps dev API host to dev reporting URL', function dev() {
      mockResolveGoDaddyApiBaseUrl.mockReturnValue('https://api.dev-godaddy.com')

      expect(getCommerceReportingApiUrl()).toBe('https://reporting.commerce.dev-godaddy.com')
    })

    it('maps test API host to test reporting URL', function test() {
      mockResolveGoDaddyApiBaseUrl.mockReturnValue('https://api.test-godaddy.com')

      expect(getCommerceReportingApiUrl()).toBe('https://reporting.commerce.test-godaddy.com')
    })

    it('maps production API host to production reporting URL', function prod() {
      mockResolveGoDaddyApiBaseUrl.mockReturnValue('https://api.godaddy.com')

      expect(getCommerceReportingApiUrl()).toBe('https://reporting.commerce.godaddy.com')
    })

    it('falls back to production URL for unknown API hosts', function unknownHost() {
      mockResolveGoDaddyApiBaseUrl.mockReturnValue('https://api.unknown.example.com')

      expect(getCommerceReportingApiUrl()).toBe('https://reporting.commerce.godaddy.com')
    })

    it('falls back to production URL when resolveGoDaddyApiBaseUrl throws', function resolverError() {
      mockResolveGoDaddyApiBaseUrl.mockImplementation(function throwError() {
        throw new Error('missing config')
      })

      expect(getCommerceReportingApiUrl()).toBe('https://reporting.commerce.godaddy.com')
    })
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'

/**
 * Auth validate route tests
 *
 * Tests the shopper ID authorization logic in the validate endpoint
 */

// Mock modules
vi.mock('@/lib/gasket-config', () => ({
  isAuthDisabled: vi.fn().mockResolvedValue(false)
}))

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    mockLogin: vi.fn().mockReturnValue(false)
  }
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/lib/gd-auth-service', () => ({
  gdAuthService: {
    extractTokenFromRequest: vi.fn(),
    authenticate: vi.fn()
  }
}))

describe('Auth validate route', function validateTests() {
  const originalEnv = process.env.NODE_ENV

  beforeEach(function setup() {
    vi.clearAllMocks()
  })

  function createRequest(token?: string): NextRequest {
    const url = 'https://example.com/api/auth/validate'
    const request = new NextRequest(url)
    
    if (token) {
      request.headers.set('authorization', `Bearer ${token}`)
    }
    
    return request
  }

  describe('Production environment shopper ID validation', function prodTests() {
    beforeEach(function setupProd() {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('ENVIRONMENT_NAME', 'production')
    })

    it('should allow 3-character shopper IDs', async function allow3Chars() {
      const { gdAuthService } = await import('@/lib/gd-auth-service')
      
      vi.mocked(gdAuthService.extractTokenFromRequest).mockReturnValue('mock-token')
      vi.mocked(gdAuthService.authenticate).mockResolvedValue({
        valid: true,
        payload: {
          shopperId: 'ABC',
          cid: 'customer-123',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        }
      })

      const request = createRequest('mock-token')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
    })

    it('should reject shopper IDs longer than 3 characters', async function reject4Chars() {
      const { gdAuthService } = await import('@/lib/gd-auth-service')
      
      vi.mocked(gdAuthService.extractTokenFromRequest).mockReturnValue('mock-token')
      vi.mocked(gdAuthService.authenticate).mockResolvedValue({
        valid: true,
        payload: {
          shopperId: 'ABCD',
          cid: 'customer-123',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        }
      })

      const request = createRequest('mock-token')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
      expect(data.authorized).toBe(false)
    })

    it('should reject shopper IDs shorter than 3 characters', async function reject2Chars() {
      const { gdAuthService } = await import('@/lib/gd-auth-service')
      
      vi.mocked(gdAuthService.extractTokenFromRequest).mockReturnValue('mock-token')
      vi.mocked(gdAuthService.authenticate).mockResolvedValue({
        valid: true,
        payload: {
          shopperId: 'AB',
          cid: 'customer-123',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        }
      })

      const request = createRequest('mock-token')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
      expect(data.authorized).toBe(false)
    })

    it('should allow numeric 3-character shopper IDs', async function allowNumeric() {
      const { gdAuthService } = await import('@/lib/gd-auth-service')
      
      vi.mocked(gdAuthService.extractTokenFromRequest).mockReturnValue('mock-token')
      vi.mocked(gdAuthService.authenticate).mockResolvedValue({
        valid: true,
        payload: {
          shopperId: '123',
          cid: 'customer-123',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        }
      })

      const request = createRequest('mock-token')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
    })

    it('should allow mixed alphanumeric 3-character shopper IDs', async function allowMixed() {
      const { gdAuthService } = await import('@/lib/gd-auth-service')
      
      vi.mocked(gdAuthService.extractTokenFromRequest).mockReturnValue('mock-token')
      vi.mocked(gdAuthService.authenticate).mockResolvedValue({
        valid: true,
        payload: {
          shopperId: 'A1B',
          cid: 'customer-123',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        }
      })

      const request = createRequest('mock-token')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
    })

    it('should reject missing shopper ID', async function rejectMissing() {
      const { gdAuthService } = await import('@/lib/gd-auth-service')
      
      vi.mocked(gdAuthService.extractTokenFromRequest).mockReturnValue('mock-token')
      vi.mocked(gdAuthService.authenticate).mockResolvedValue({
        valid: true,
        payload: {
          cid: 'customer-123',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        }
      })

      const request = createRequest('mock-token')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
      expect(data.authorized).toBe(false)
    })
  })

  describe('Non-production environments', function nonProdTests() {
    beforeEach(function setupDev() {
      vi.stubEnv('NODE_ENV', 'development')
    })

    it('should allow any shopper ID length in development', async function allowAny() {
      const { gdAuthService } = await import('@/lib/gd-auth-service')
      
      vi.mocked(gdAuthService.extractTokenFromRequest).mockReturnValue('mock-token')
      vi.mocked(gdAuthService.authenticate).mockResolvedValue({
        valid: true,
        payload: {
          shopperId: 'VERYLONGSHOPPERID123',
          cid: 'customer-123',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        }
      })

      const request = createRequest('mock-token')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
    })
  })

  describe('Token validation failures', function tokenTests() {
    beforeEach(function setupProd() {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('ENVIRONMENT_NAME', 'production')
    })

    it('should reject invalid tokens before shopper ID check', async function rejectInvalid() {
      const { gdAuthService } = await import('@/lib/gd-auth-service')
      
      vi.mocked(gdAuthService.extractTokenFromRequest).mockReturnValue('mock-token')
      vi.mocked(gdAuthService.authenticate).mockResolvedValue({
        valid: false,
        reason: 'Token expired'
      })

      const request = createRequest('mock-token')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.valid).toBe(false)
      expect(data.reason).toBe('Token expired')
    })
  })

  afterEach(function cleanup() {
    vi.unstubAllEnvs()
  })
})


import { beforeEach, describe, it, expect, vi } from 'vitest'

// Hoisted mocks — must be declared before vi.mock factories that reference them
const { mockMemoryGet, mockMemorySet } = vi.hoisted(() => ({
  mockMemoryGet: vi.fn(),
  mockMemorySet: vi.fn(),
}))

// Mock database connection
vi.mock('../../../database/connection.js', () => ({
  db: {
    prepare: vi.fn(),
    exec: vi.fn(),
    transaction: vi.fn(),
  },
}))

// Mock Logger
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(function () { return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }; }),
  },
}))

// Mock MemoryRepository
vi.mock('../../../database/repositories/MemoryRepository.js', () => ({
  MemoryRepository: vi.fn(function () { return {
    get: mockMemoryGet,
    set: mockMemorySet,
  }; }),
}))

// Import after mocks
import { mergeBrandIdentity, brandIdentityAITool, type BrandIdentity } from '../brand-identity.js'

const createContext = (appId: string) => ({
  experimental_context: { metadata: { appId } },
})

describe('mergeBrandIdentity', () => {
  it('overwrites brandName when update provides one', () => {
    const existing: BrandIdentity = { brandName: 'Old Name', tagline: 'Stay bold' }
    const update: BrandIdentity = { brandName: 'New Name' }

    const result = mergeBrandIdentity(existing, update)

    expect(result.brandName).toBe('New Name')
    expect(result.tagline).toBe('Stay bold')
  })

  it('preserves existing brandName when update does not include it', () => {
    const existing: BrandIdentity = { brandName: 'Keep Me' }
    const update: BrandIdentity = { tagline: 'Fresh tagline' }

    const result = mergeBrandIdentity(existing, update)

    expect(result.brandName).toBe('Keep Me')
    expect(result.tagline).toBe('Fresh tagline')
  })

  it('sets brandName on empty existing identity', () => {
    const existing: BrandIdentity = {}
    const update: BrandIdentity = { brandName: 'First Name' }

    const result = mergeBrandIdentity(existing, update)

    expect(result.brandName).toBe('First Name')
  })

  it('merges all top-level fields independently', () => {
    const existing: BrandIdentity = {
      brandName: 'Acme',
      personality: { traits: ['bold'] },
      tagline: 'Old tagline',
    }
    const update: BrandIdentity = {
      tagline: 'New tagline',
      voice: { tone: 'friendly' },
    }

    const result = mergeBrandIdentity(existing, update)

    expect(result.brandName).toBe('Acme')
    expect(result.personality).toEqual({ traits: ['bold'] })
    expect(result.tagline).toBe('New tagline')
    expect(result.voice).toEqual({ tone: 'friendly' })
  })

  it('merges the business-signal fields (salesType, vertical, location) independently', () => {
    const existing: BrandIdentity = { brandName: 'Acme', vertical: 'old vertical' }
    const update: BrandIdentity = {
      salesType: 'in_store',
      vertical: 'coffee roaster',
      location: '123 Main St, Austin TX',
    }

    const result = mergeBrandIdentity(existing, update)

    expect(result.brandName).toBe('Acme')
    expect(result.salesType).toBe('in_store')
    expect(result.vertical).toBe('coffee roaster')
    expect(result.location).toBe('123 Main St, Austin TX')
  })

  it('preserves a stored vertical when the update does not change it', () => {
    const existing: BrandIdentity = { vertical: 'law firm', salesType: 'service' }
    const update: BrandIdentity = { brandName: 'Acme Legal' }

    const result = mergeBrandIdentity(existing, update)

    expect(result.vertical).toBe('law firm')
    expect(result.salesType).toBe('service')
    expect(result.brandName).toBe('Acme Legal')
  })

  it('does not remove existing fields when update has undefined values', () => {
    const existing: BrandIdentity = {
      brandName: 'Keep',
      personality: { traits: ['fun'] },
      voice: { tone: 'warm' },
      audience: { segments: ['teens'] },
    }
    const update: BrandIdentity = {}

    const result = mergeBrandIdentity(existing, update)

    expect(result).toEqual(existing)
  })
})

describe('brandIdentityAITool execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMemoryGet.mockResolvedValue({ success: true, exists: false, value: null })
    mockMemorySet.mockResolvedValue({ success: true })
  })

  describe('get mode', () => {
    it('returns brand identity data when it exists', async () => {
      mockMemoryGet.mockResolvedValue({
        success: true,
        exists: true,
        value: { brandName: 'Acme', tagline: 'Be bold' },
      })

      const result = await brandIdentityAITool.execute(
        { mode: 'get' },
        createContext('app-1')
      )

      expect(result).toContain('Brand Identity Data')
      expect(result).toContain('Acme')
      expect(result).toContain('Be bold')
    })

    it('returns empty state message when no data exists', async () => {
      mockMemoryGet.mockResolvedValue({ success: true, exists: false, value: null })

      const result = await brandIdentityAITool.execute(
        { mode: 'get' },
        createContext('app-1')
      )

      expect(result).toContain('No brand identity data saved yet')
    })

    it('returns error when memory read fails', async () => {
      mockMemoryGet.mockResolvedValue({ success: false, exists: false, value: null, error: 'DB locked' })

      const result = await brandIdentityAITool.execute(
        { mode: 'get' },
        createContext('app-1')
      )

      expect(result).toContain('Error')
      expect(result).toContain('Failed to read brand identity data')
      expect(result).not.toContain('No brand identity data saved yet')
    })
  })

  describe('set mode', () => {
    it('merges and saves brand identity data', async () => {
      mockMemoryGet.mockResolvedValue({
        success: true,
        exists: true,
        value: { tagline: 'Existing' },
      })
      mockMemorySet.mockResolvedValue({ success: true })

      const result = await brandIdentityAITool.execute(
        { mode: 'set', brandName: 'NewCo' },
        createContext('app-1')
      )

      expect(result).toContain('Brand Identity Updated')
      expect(result).toContain('brandName')
      expect(mockMemorySet).toHaveBeenCalledWith('app-1', 'brand.identity', {
        tagline: 'Existing',
        brandName: 'NewCo',
      })
    })

    it('returns error when memory read fails', async () => {
      mockMemoryGet.mockResolvedValue({ success: false, exists: false, value: null, error: 'DB error' })

      const result = await brandIdentityAITool.execute(
        { mode: 'set', brandName: 'NewCo' },
        createContext('app-1')
      )

      expect(result).toContain('Error')
      expect(result).toContain('Failed to read existing brand identity')
      expect(mockMemorySet).not.toHaveBeenCalled()
    })

    it('returns error when memory write fails', async () => {
      mockMemoryGet.mockResolvedValue({ success: true, exists: false, value: null })
      mockMemorySet.mockResolvedValue({ success: false, error: 'Write failed' })

      const result = await brandIdentityAITool.execute(
        { mode: 'set', brandName: 'NewCo' },
        createContext('app-1')
      )

      expect(result).toContain('Error')
      expect(result).toContain('Failed to save brand identity data')
    })
  })

  it('returns error when no appId in context', async () => {
    const result = await brandIdentityAITool.execute(
      { mode: 'get' },
      { experimental_context: { metadata: {} } }
    )

    expect(result).toContain('Error')
    expect(result).toContain('No app ID')
  })
})

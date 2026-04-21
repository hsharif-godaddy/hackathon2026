import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { llmMetadataContext, createSelectiveBetaHeaderFetch } from '../unified-provider.js'

/**
 * Tests for budget header injection in the REAL fetch wrappers.
 *
 * These tests exercise createSelectiveBetaHeaderFetch directly by injecting
 * a mock fetch, ensuring that:
 * - x-gocode-budget-id: the budgetSessionId only (not budgetId:budgetSessionId)
 * - x-gocode-budget-service-name: 'airo-app-builder'
 *
 * Unlike a mirrored test, these will fail if the production code regresses.
 */

describe('Budget header injection (production code)', () => {
  let capturedHeaders: Headers | null = null
  let capturedBody: string | null = null
  const mockFetch = vi.fn()

  beforeEach(() => {
    capturedHeaders = null
    capturedBody = null
    mockFetch.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers)
      capturedBody = init?.body as string
      return new Response(JSON.stringify({ choices: [] }), { status: 200 })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('when budgetSessionId is present in metadata', () => {
    it('sets x-gocode-budget-id to budgetSessionId only (not budgetId:budgetSessionId)', async () => {
      const wrappedFetch = createSelectiveBetaHeaderFetch([], mockFetch)

      await llmMetadataContext.run(
        {
          user: 'test-user',
          tags: ['test'],
          budgetId: 'budget-123',
          budgetSessionId: 'session-456',
        },
        async () => {
          await wrappedFetch('https://api.example.com/v1/chat', {
            method: 'POST',
            body: JSON.stringify({ messages: [] }),
          })
        }
      )

      expect(capturedHeaders?.get('x-gocode-budget-id')).toBe('session-456')
      // Verify it's NOT the old format (budgetId:budgetSessionId)
      expect(capturedHeaders?.get('x-gocode-budget-id')).not.toContain('budget-123')
      expect(capturedHeaders?.get('x-gocode-budget-id')).not.toContain(':')
    })

    it('sets x-gocode-budget-service-name to airo-app-builder', async () => {
      const wrappedFetch = createSelectiveBetaHeaderFetch([], mockFetch)

      await llmMetadataContext.run(
        {
          user: 'test-user',
          tags: ['test'],
          budgetId: 'budget-123',
          budgetSessionId: 'session-456',
        },
        async () => {
          await wrappedFetch('https://api.example.com/v1/chat', {
            method: 'POST',
            body: JSON.stringify({ messages: [] }),
          })
        }
      )

      expect(capturedHeaders?.get('x-gocode-budget-service-name')).toBe('airo-app-builder')
      // Verify it's NOT the old value
      expect(capturedHeaders?.get('x-gocode-budget-service-name')).not.toBe('airo-bms')
    })

    it('works with only budgetSessionId (no budgetId)', async () => {
      const wrappedFetch = createSelectiveBetaHeaderFetch([], mockFetch)

      await llmMetadataContext.run(
        {
          user: 'test-user',
          tags: ['test'],
          budgetSessionId: 'session-789',
        },
        async () => {
          await wrappedFetch('https://api.example.com/v1/chat', {
            method: 'POST',
            body: JSON.stringify({ messages: [] }),
          })
        }
      )

      expect(capturedHeaders?.get('x-gocode-budget-id')).toBe('session-789')
      expect(capturedHeaders?.get('x-gocode-budget-service-name')).toBe('airo-app-builder')
    })
  })

  describe('when budgetSessionId is NOT present in metadata', () => {
    it('does not set budget headers when metadata has budgetId but no budgetSessionId', async () => {
      const wrappedFetch = createSelectiveBetaHeaderFetch([], mockFetch)

      await llmMetadataContext.run(
        {
          user: 'test-user',
          tags: ['test'],
          budgetId: 'budget-123',
          // No budgetSessionId
        },
        async () => {
          await wrappedFetch('https://api.example.com/v1/chat', {
            method: 'POST',
            body: JSON.stringify({ messages: [] }),
          })
        }
      )

      expect(capturedHeaders?.get('x-gocode-budget-id')).toBeNull()
      expect(capturedHeaders?.get('x-gocode-budget-service-name')).toBeNull()
    })

    it('does not set budget headers when no metadata context', async () => {
      const wrappedFetch = createSelectiveBetaHeaderFetch([], mockFetch)

      // Call outside of llmMetadataContext.run
      await wrappedFetch('https://api.example.com/v1/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: [] }),
      })

      expect(capturedHeaders?.get('x-gocode-budget-id')).toBeNull()
      expect(capturedHeaders?.get('x-gocode-budget-service-name')).toBeNull()
    })

    it('does not set budget headers when budgetSessionId is empty string', async () => {
      const wrappedFetch = createSelectiveBetaHeaderFetch([], mockFetch)

      await llmMetadataContext.run(
        {
          user: 'test-user',
          tags: ['test'],
          budgetId: 'budget-123',
          budgetSessionId: '',
        },
        async () => {
          await wrappedFetch('https://api.example.com/v1/chat', {
            method: 'POST',
            body: JSON.stringify({ messages: [] }),
          })
        }
      )

      expect(capturedHeaders?.get('x-gocode-budget-id')).toBeNull()
      expect(capturedHeaders?.get('x-gocode-budget-service-name')).toBeNull()
    })
  })
})

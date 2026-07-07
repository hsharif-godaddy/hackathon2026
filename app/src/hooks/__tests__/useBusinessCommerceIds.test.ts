/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

import { fetchCommerceStoreId, useCommerceStoreId } from '@/hooks/useBusinessCommerceIds'
import { appFetch } from '@/lib/gasket-config'
import { renderHookWithProviders } from '@/tests/test-utils'

const COMMERCE_BINDING_URL = '/api/apps/app-1/commerce/binding'

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
  AuthSessionExpiredError: class AuthSessionExpiredError extends Error {
    constructor() {
      super('Authentication session expired')
      this.name = 'AuthSessionExpiredError'
    }
  },
}))

function mockBindingResponse(body: unknown, status = 200) {
  vi.mocked(appFetch).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as Response)
}

describe('useBusinessCommerceIds', function packageTests() {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('#fetchCommerceStoreId', function fetchCommerceStoreIdTests() {
    it('returns store id from commerce binding', async function configured() {
      mockBindingResponse({
        configured: true,
        binding: { storeId: 'store-abc' },
      })

      await expect(fetchCommerceStoreId('app-1')).resolves.toBe('store-abc')
      expect(appFetch).toHaveBeenCalledWith(COMMERCE_BINDING_URL, {}, { handle401: true })
    })

    it('returns null when commerce is not configured', async function unconfigured() {
      mockBindingResponse({ configured: false, binding: null })

      await expect(fetchCommerceStoreId('app-1')).resolves.toBeNull()
    })

    it('returns null when binding has no store id', async function noStore() {
      mockBindingResponse({
        configured: true,
        binding: { storeId: null },
      })

      await expect(fetchCommerceStoreId('app-1')).resolves.toBeNull()
    })

    it('throws when binding request fails', async function failure() {
      mockBindingResponse({ error: 'Failed to fetch commerce binding' }, 500)

      await expect(fetchCommerceStoreId('app-1')).rejects.toThrow('Failed to fetch commerce binding')
    })
  })

  describe('#useCommerceStoreId', function commerceStoreIdTests() {
    it('does not fetch when appId is missing', async function disabled() {
      const { result } = renderHookWithProviders(() => useCommerceStoreId(null))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(appFetch).not.toHaveBeenCalled()
    })

    it('returns store id from commerce binding', async function success() {
      mockBindingResponse({
        configured: true,
        binding: { storeId: 'store-abc' },
      })

      const { result } = renderHookWithProviders(() => useCommerceStoreId('app-1'))

      await waitFor(() => {
        expect(result.current.data).toBe('store-abc')
      })
    })
  })
})

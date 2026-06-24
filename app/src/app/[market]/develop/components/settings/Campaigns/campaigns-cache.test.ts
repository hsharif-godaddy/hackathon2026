/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteCampaignRequest,
  fetchCampaignList,
  fetchCampaignWithAssets,
} from '@/app/[market]/develop/components/settings/Campaigns/campaigns-cache'

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: vi.fn(async (path: string) => `https://agent.test/${path}`),
}))

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

describe('campaigns-cache', function campaignsCacheTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
  })

  describe('#fetchCampaignList', function fetchCampaignListTests() {
    it('returns campaigns with assets merged', async function mergeAssets() {
      const { agentFetch } = await import('@/lib/agent-fetch')
      vi.mocked(agentFetch).mockImplementation(async (url: string) => ({
        ok: true,
        json: async () => {
          if (String(url).endsWith('/c1')) {
            return { campaign: { id: 'c1', assets: [{ id: 'a1' }] } }
          }
          return { campaigns: [{ id: 'c1', name: 'Test', status: 'ready' }] }
        },
      } as Response))

      const campaigns = await fetchCampaignList('app-1')

      expect(campaigns).toHaveLength(1)
      expect(campaigns[0].id).toBe('c1')
      expect(campaigns[0].assets).toEqual([{ id: 'a1' }])
    })

    it('throws when the list request is not ok', async function listError() {
      const { agentFetch } = await import('@/lib/agent-fetch')
      vi.mocked(agentFetch).mockResolvedValue({ ok: false } as Response)

      await expect(fetchCampaignList('app-2')).rejects.toThrow('Failed to load campaigns')
    })

    it('returns empty array when campaigns field is missing', async function emptyList() {
      const { agentFetch } = await import('@/lib/agent-fetch')
      vi.mocked(agentFetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response)

      const campaigns = await fetchCampaignList('app-3')
      expect(campaigns).toEqual([])
    })
  })

  describe('#fetchCampaignWithAssets', function fetchAssetsTests() {
    it('merges assets from detail response', async function mergeDetail() {
      const { agentFetch } = await import('@/lib/agent-fetch')
      vi.mocked(agentFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ campaign: { id: 'c1', assets: [{ id: 'a1' }] } }),
      } as Response)

      const base = { id: 'c1', name: 'Test' } as Parameters<typeof fetchCampaignWithAssets>[1]
      const result = await fetchCampaignWithAssets('app-1', base)

      expect(result.assets).toEqual([{ id: 'a1' }])
    })

    it('returns original campaign when detail response is not ok', async function detailNotOk() {
      const { agentFetch } = await import('@/lib/agent-fetch')
      vi.mocked(agentFetch).mockResolvedValue({ ok: false } as Response)

      const base = { id: 'c1', name: 'Test' } as Parameters<typeof fetchCampaignWithAssets>[1]
      const result = await fetchCampaignWithAssets('app-1', base)

      expect(result).toBe(base)
    })

    it('returns original campaign when fetch throws', async function detailThrows() {
      const { agentFetch } = await import('@/lib/agent-fetch')
      vi.mocked(agentFetch).mockRejectedValue(new Error('network error'))

      const base = { id: 'c1', name: 'Test' } as Parameters<typeof fetchCampaignWithAssets>[1]
      const result = await fetchCampaignWithAssets('app-1', base)

      expect(result).toBe(base)
    })
  })

  describe('#deleteCampaignRequest', function deleteTests() {
    it('returns true when delete succeeds', async function deleteSuccess() {
      const { agentFetch } = await import('@/lib/agent-fetch')
      vi.mocked(agentFetch).mockResolvedValue({ ok: true } as Response)

      const result = await deleteCampaignRequest('app-1', 'c1')

      expect(result).toBe(true)
      expect(vi.mocked(agentFetch)).toHaveBeenCalledWith(
        'https://agent.test/campaigns/app-1/c1',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })

    it('returns false when response is not ok', async function deleteNotOk() {
      const { agentFetch } = await import('@/lib/agent-fetch')
      vi.mocked(agentFetch).mockResolvedValue({ ok: false } as Response)

      const result = await deleteCampaignRequest('app-1', 'c1')

      expect(result).toBe(false)
    })
  })
})

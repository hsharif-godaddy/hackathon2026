import { describe, it, expect, vi } from 'vitest'
import { getPersistedAgentIdForApp } from '../persisted-agent.js'
import type { ConversationLifecycleStore } from '../../memory/interfaces/conversation-store.js'

function storeReturning(latest: { agentId: string } | null): ConversationLifecycleStore {
  return {
    getLatestForApp: vi.fn().mockResolvedValue(latest),
  } as unknown as ConversationLifecycleStore
}

describe('getPersistedAgentIdForApp', function getPersistedAgentIdForAppTests() {
  it('returns undefined for a brand-new app with no conversation (null → undefined contract)', async function brandNewApp() {
    const store = storeReturning(null)

    const agentId = await getPersistedAgentIdForApp(store, 'app_brand_new')

    // The router relies on this undefined to fall through to the initial heuristic.
    expect(agentId).toBeUndefined()
  })

  it('returns the persisted conversation agentId when a conversation exists', async function existingConversation() {
    const store = storeReturning({ agentId: 'initial-v3-exp' })

    const agentId = await getPersistedAgentIdForApp(store, 'app_existing')

    expect(agentId).toBe('initial-v3-exp')
    expect(store.getLatestForApp).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app_existing' }))
  })
})

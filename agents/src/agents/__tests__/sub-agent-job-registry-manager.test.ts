import { describe, it, expect } from 'vitest'
import { SubAgentJobRegistryManager } from '../sub-agent-job-registry.js'

describe('SubAgentJobRegistryManager', () => {
  it('returns the same registry instance for a conversationId', () => {
    const mgr = new SubAgentJobRegistryManager({ maxConversations: 10 })
    const a = mgr.get('conv-1')
    const b = mgr.get('conv-1')
    expect(a).toBe(b)
  })

  it('evicts the least-recently-used conversation past the cap', () => {
    const mgr = new SubAgentJobRegistryManager({ maxConversations: 2 })
    const r1 = mgr.get('c1')
    mgr.get('c2')
    mgr.get('c1') // touch c1 so c2 is now LRU
    mgr.get('c3') // evicts c2
    expect(mgr.get('c1')).toBe(r1)        // still present (same instance)
    expect(mgr.has('c2')).toBe(false)      // evicted
  })

  it('abort(conversationId) aborts that conversation\'s jobs and drops it', () => {
    const mgr = new SubAgentJobRegistryManager({ maxConversations: 10 })
    mgr.get('c1')
    mgr.abort('c1')
    expect(mgr.has('c1')).toBe(false)
  })
})

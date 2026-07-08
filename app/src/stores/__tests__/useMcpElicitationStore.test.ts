import { beforeEach, describe, expect, it } from 'vitest'

import { type PendingMcpElicitation, useMcpElicitationStore } from '../useMcpElicitationStore'

const formPending: PendingMcpElicitation = {
  id: 'settings',
  serverId: 'inventory',
  serverDisplayName: 'Inventory MCP',
  toolName: 'inventory_settings_configure',
  mode: 'form',
  message: 'Configure inventory',
  requestedSchema: { type: 'object', properties: { rate: { type: 'number' } } },
}

describe('useMcpElicitationStore', () => {
  beforeEach(() => {
    useMcpElicitationStore.setState({ pending: null, resolve: null })
  })

  it('publishes a pending elicitation and resolves it via respond', async () => {
    const promise = useMcpElicitationStore.getState().request(formPending)
    expect(useMcpElicitationStore.getState().pending).toEqual(formPending)

    useMcpElicitationStore.getState().respond({ action: 'accept', content: { rate: 8 } })
    await expect(promise).resolves.toEqual({ action: 'accept', content: { rate: 8 } })
    expect(useMcpElicitationStore.getState().pending).toBeNull()
  })

  it('cancel settles the awaiter with a cancel action', async () => {
    const promise = useMcpElicitationStore.getState().request(formPending)
    useMcpElicitationStore.getState().cancel()
    await expect(promise).resolves.toEqual({ action: 'cancel' })
    expect(useMcpElicitationStore.getState().pending).toBeNull()
  })

  it('a new request supersedes and cancels the previous one', async () => {
    const first = useMcpElicitationStore.getState().request(formPending)
    const second = useMcpElicitationStore
      .getState()
      .request({ ...formPending, id: 'other', message: 'Second' })

    await expect(first).resolves.toEqual({ action: 'cancel' })
    expect(useMcpElicitationStore.getState().pending?.message).toBe('Second')

    useMcpElicitationStore.getState().respond({ action: 'decline' })
    await expect(second).resolves.toEqual({ action: 'decline' })
  })
})

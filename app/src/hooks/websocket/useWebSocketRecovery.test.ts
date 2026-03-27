/**
 * @vitest-environment jsdom
 */
/**
 * useWebSocketRecovery Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useWebSocketRecovery } from './useWebSocketRecovery'

describe('useWebSocketRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes with null refs', () => {
    const { result } = renderHook(() => useWebSocketRecovery())

    expect(result.current.wasRecoveredRef.current).toBe(false)
    expect(result.current.serverConfigRef.current).toBeNull()
    expect(result.current.pendingRecoveryAckRef.current).toBeNull()
  })

  describe('maybeSendRecoveryAck', () => {
    it('does not send ack if no pending recovery', () => {
      const { result } = renderHook(() => useWebSocketRecovery())
      const mockSocket = { emit: vi.fn() } as any

      result.current.maybeSendRecoveryAck(mockSocket)

      expect(mockSocket.emit).not.toHaveBeenCalled()
    })

    it('does not send ack if socket is null', () => {
      const { result } = renderHook(() => useWebSocketRecovery())

      result.current.pendingRecoveryAckRef.current = {
        conversationId: 'conv-1',
        lastSequence: 10,
        expectedCount: 5,
        receivedCount: 5,
        replayComplete: true,
        ackEvent: 'recovery_ack',
      }

      result.current.maybeSendRecoveryAck(null)

      // Should not throw
    })

    it('does not send ack if replay is not complete', () => {
      const { result } = renderHook(() => useWebSocketRecovery())
      const mockSocket = { emit: vi.fn() } as any

      result.current.pendingRecoveryAckRef.current = {
        conversationId: 'conv-1',
        lastSequence: 10,
        expectedCount: 5,
        receivedCount: 3,
        replayComplete: false,
        ackEvent: 'recovery_ack',
      }

      result.current.maybeSendRecoveryAck(mockSocket)

      expect(mockSocket.emit).not.toHaveBeenCalled()
    })

    it('does not send ack if received count is less than expected (not forced)', () => {
      const { result } = renderHook(() => useWebSocketRecovery())
      const mockSocket = { emit: vi.fn() } as any

      result.current.pendingRecoveryAckRef.current = {
        conversationId: 'conv-1',
        lastSequence: 10,
        expectedCount: 5,
        receivedCount: 3,
        replayComplete: true,
        ackEvent: 'recovery_ack',
      }

      result.current.maybeSendRecoveryAck(mockSocket, false)

      expect(mockSocket.emit).not.toHaveBeenCalled()
    })

    it('sends ack when replay is complete and counts match', () => {
      const { result } = renderHook(() => useWebSocketRecovery())
      const mockSocket = { emit: vi.fn() } as any

      result.current.pendingRecoveryAckRef.current = {
        conversationId: 'conv-1',
        lastSequence: 10,
        expectedCount: 5,
        receivedCount: 5,
        replayComplete: true,
        ackEvent: 'recovery_ack',
      }

      result.current.maybeSendRecoveryAck(mockSocket)

      expect(mockSocket.emit).toHaveBeenCalledWith('recovery_ack', {
        conversationId: 'conv-1',
        lastSequence: 10,
      })
      expect(result.current.pendingRecoveryAckRef.current).toBeNull()
    })

    it('sends catchup_ack when replay is complete', () => {
      const { result } = renderHook(() => useWebSocketRecovery())
      const mockSocket = { emit: vi.fn() } as any

      result.current.pendingRecoveryAckRef.current = {
        conversationId: 'conv-2',
        lastSequence: 50,
        expectedCount: 0,
        receivedCount: 0,
        replayComplete: true,
        ackEvent: 'catchup_ack',
      }

      result.current.maybeSendRecoveryAck(mockSocket)

      expect(mockSocket.emit).toHaveBeenCalledWith('catchup_ack', {
        conversationId: 'conv-2',
        lastSequence: 50,
      })
      expect(result.current.pendingRecoveryAckRef.current).toBeNull()
    })

    it('sends ack when forced even if counts do not match', () => {
      const { result } = renderHook(() => useWebSocketRecovery())
      const mockSocket = { emit: vi.fn() } as any

      result.current.pendingRecoveryAckRef.current = {
        conversationId: 'conv-1',
        lastSequence: 10,
        expectedCount: 5,
        receivedCount: 3,
        replayComplete: true,
        ackEvent: 'recovery_ack',
      }

      result.current.maybeSendRecoveryAck(mockSocket, true)

      expect(mockSocket.emit).toHaveBeenCalledWith('recovery_ack', {
        conversationId: 'conv-1',
        lastSequence: 10,
      })
      expect(result.current.pendingRecoveryAckRef.current).toBeNull()
    })
  })

  describe('trackReplayEventReceipt', () => {
    it('does nothing if no pending recovery', () => {
      const { result } = renderHook(() => useWebSocketRecovery())
      const mockSocket = { emit: vi.fn() } as any

      result.current.trackReplayEventReceipt(mockSocket, 'chunk')

      expect(mockSocket.emit).not.toHaveBeenCalled()
    })

    it('does nothing if socket is null', () => {
      const { result } = renderHook(() => useWebSocketRecovery())

      result.current.pendingRecoveryAckRef.current = {
        conversationId: 'conv-1',
        lastSequence: 10,
        expectedCount: 3,
        receivedCount: 0,
        replayComplete: false,
        ackEvent: 'recovery_ack',
      }

      result.current.trackReplayEventReceipt(null, 'chunk')

      // Should not throw
      expect(result.current.pendingRecoveryAckRef.current.receivedCount).toBe(0)
    })

    it('skips control messages (recovery_status, replay_complete, etc)', () => {
      const { result } = renderHook(() => useWebSocketRecovery())
      const mockSocket = { emit: vi.fn() } as any

      result.current.pendingRecoveryAckRef.current = {
        conversationId: 'conv-1',
        lastSequence: 10,
        expectedCount: 3,
        receivedCount: 0,
        replayComplete: false,
        ackEvent: 'recovery_ack',
      }

      const controlMessages = ['recovery_status', 'replay_complete', 'catchup_status', 'catchup_complete']

      controlMessages.forEach((eventType) => {
        result.current.trackReplayEventReceipt(mockSocket, eventType)
      })

      // Count should not increment for control messages
      expect(result.current.pendingRecoveryAckRef.current.receivedCount).toBe(0)
      expect(mockSocket.emit).not.toHaveBeenCalled()
    })

    it('increments received count for non-control messages', () => {
      const { result } = renderHook(() => useWebSocketRecovery())
      const mockSocket = { emit: vi.fn() } as any

      result.current.pendingRecoveryAckRef.current = {
        conversationId: 'conv-1',
        lastSequence: 10,
        expectedCount: 3,
        receivedCount: 0,
        replayComplete: false,
        ackEvent: 'recovery_ack',
      }

      result.current.trackReplayEventReceipt(mockSocket, 'chunk')

      expect(result.current.pendingRecoveryAckRef.current.receivedCount).toBe(1)
    })

    it('increments received count for each non-control message', () => {
      const { result } = renderHook(() => useWebSocketRecovery())
      const mockSocket = { emit: vi.fn() } as any

      result.current.pendingRecoveryAckRef.current = {
        conversationId: 'conv-1',
        lastSequence: 10,
        expectedCount: 3,
        receivedCount: 0,
        replayComplete: false,
        ackEvent: 'recovery_ack',
      }

      result.current.trackReplayEventReceipt(mockSocket, 'chunk')
      result.current.trackReplayEventReceipt(mockSocket, 'tool_start')
      result.current.trackReplayEventReceipt(mockSocket, 'tool_result')

      expect(result.current.pendingRecoveryAckRef.current.receivedCount).toBe(3)
    })
  })

  it('functions are stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useWebSocketRecovery())

    const firstMaybeSendFn = result.current.maybeSendRecoveryAck
    const firstTrackFn = result.current.trackReplayEventReceipt

    rerender()

    expect(result.current.maybeSendRecoveryAck).toBe(firstMaybeSendFn)
    expect(result.current.trackReplayEventReceipt).toBe(firstTrackFn)
  })

  it('refs persist across re-renders', () => {
    const { result, rerender } = renderHook(() => useWebSocketRecovery())

    // Set values
    result.current.wasRecoveredRef.current = true
    result.current.serverConfigRef.current = {
      streamRecoveryWindow: 300000,
      ackTimeout: 30000,
    }

    rerender()

    // Verify values persisted
    expect(result.current.wasRecoveredRef.current).toBe(true)
    expect(result.current.serverConfigRef.current).toEqual({
      streamRecoveryWindow: 300000,
      ackTimeout: 30000,
    })
  })
})

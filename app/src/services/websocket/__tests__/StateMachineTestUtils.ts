/**
 * State Machine Test Utilities
 *
 * Provides test harness for testing the XState WebSocket machine in isolation.
 * Enables testing state transitions without needing React, Zustand, or actual WebSocket connections.
 */

import { type Actor, createActor, waitFor } from 'xstate'

import type { MachineContext, MachineEvent } from '../stateMachineTypes'
import type { WebSocketMachine } from '../webSocketMachine'

export class StateMachineTestHarness {
  actor: Actor<WebSocketMachine>

  constructor(
    machine: WebSocketMachine,
    initialContext?: Partial<MachineContext>
  ) {
    this.actor = createActor(machine, {
      input: initialContext,
    })
    this.actor.start()
  }

  async sendAndWaitFor(
    event: MachineEvent,
    stateMatcher: (state: any) => boolean,
    timeout = 5000
  ): Promise<void> {
    this.actor.send(event)
    await waitFor(
      this.actor,
      stateMatcher,
      { timeout }
    )
  }

  assertState(matcher: (state: any) => boolean, errorMessage?: string): void {
    const snapshot = this.actor.getSnapshot()
    if (!matcher(snapshot)) {
      const message = errorMessage || `State assertion failed: ${JSON.stringify(snapshot.value)}`
      throw new Error(message)
    }
  }

  assertContext(matcher: (context: MachineContext) => boolean, errorMessage?: string): void {
    const snapshot = this.actor.getSnapshot()
    if (!matcher(snapshot.context)) {
      const message = errorMessage || `Context assertion failed: ${JSON.stringify(snapshot.context)}`
      throw new Error(message)
    }
  }

  getSnapshot() {
    return this.actor.getSnapshot()
  }

  getState() {
    return this.getSnapshot().value
  }

  getContext() {
    return this.getSnapshot().context
  }

  // Convenience methods for common events
  simulateConnect(appId: string): void {
    this.actor.send({ type: 'CONNECT', appId })
  }

  simulateConnectionEstablished(socketId: string): void {
    this.actor.send({ type: 'CONNECTION_ESTABLISHED', socketId })
  }

  simulateDisconnect(reason: string): void {
    this.actor.send({ type: 'DISCONNECT', reason })
  }

  simulateStreamStart(conversationId: string, messageId: string): void {
    this.actor.send({ type: 'STREAM_STARTED', conversationId, messageId })
  }

  simulateStreamComplete(): void {
    this.actor.send({ type: 'STREAM_COMPLETE' })
  }

  simulateStreamError(error: Error, retryable: boolean): void {
    this.actor.send({ type: 'STREAM_ERROR', error, retryable })
  }

  simulateRecoveryFlow(recoveryId: string, expectedEvents: number): void {
    this.actor.send({ type: 'RECOVERY_STATUS', recoveryId, expectedEvents })
  }

  simulateReplayEvent(): void {
    this.actor.send({ type: 'REPLAY_EVENT_RECEIVED' })
  }

  simulateReplayComplete(): void {
    this.actor.send({ type: 'REPLAY_COMPLETE' })
  }

  simulateCatchupStatus(catchupId: string): void {
    this.actor.send({ type: 'CATCHUP_STATUS', catchupId })
  }

  simulateCatchupComplete(): void {
    this.actor.send({ type: 'CATCHUP_COMPLETE' })
  }

  simulateRecoveryAckSent(): void {
    this.actor.send({ type: 'RECOVERY_ACK_SENT' })
  }

  destroy(): void {
    this.actor.stop()
  }
}

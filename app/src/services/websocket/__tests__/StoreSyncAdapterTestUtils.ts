/**
 * Store Sync Adapter Test Utilities
 *
 * Provides test harness for testing the StoreSyncAdapter in isolation.
 * Verifies that machine transitions correctly trigger store actions.
 */

import { EventEmitter } from 'events'

import { createMockStore } from './MockFactories'
import { StateMachineTestHarness } from './StateMachineTestUtils'
import type { MachineEvent } from '../stateMachineTypes'
import { StoreSyncAdapter } from '../StoreSyncAdapter'
import { webSocketMachine } from '../webSocketMachine'

export class StoreSyncAdapterTestHarness {
  machine: StateMachineTestHarness
  mockStore: ReturnType<typeof createMockStore>
  mockController: EventEmitter
  adapter: StoreSyncAdapter

  constructor() {
    this.machine = new StateMachineTestHarness(webSocketMachine)
    this.mockStore = createMockStore()
    this.mockController = new EventEmitter()
    this.adapter = new StoreSyncAdapter(
      this.machine.actor,
      this.mockController as any,
      () => this.mockStore
    )
  }

  /**
   * Assert a store action was called
   */
  assertStoreActionCalled(
    actionName: keyof ReturnType<typeof createMockStore>,
    times = 1
  ): void {
    const mock = this.mockStore[actionName]
    if (!mock) {
      throw new Error(`Store action ${actionName} does not exist`)
    }

    const actualCalls = mock.mock.calls.length
    if (actualCalls !== times) {
      throw new Error(
        `Expected ${actionName} to be called ${times} time(s), but was called ${actualCalls} time(s)`
      )
    }
  }

  /**
   * Assert a store action was called with specific arguments
   */
  assertStoreActionCalledWith(
    actionName: keyof ReturnType<typeof createMockStore>,
    ...expectedArgs: any[]
  ): void {
    const mock = this.mockStore[actionName]
    if (!mock) {
      throw new Error(`Store action ${actionName} does not exist`)
    }

    const lastCall = mock.mock.calls[mock.mock.calls.length - 1]
    if (!lastCall) {
      throw new Error(`Store action ${actionName} was never called`)
    }

    // Deep equality check for objects
    const argsMatch = expectedArgs.every((expectedArg, index) => {
      const actualArg = lastCall[index]

      if (typeof expectedArg === 'object' && expectedArg !== null) {
        return JSON.stringify(actualArg) === JSON.stringify(expectedArg)
      }

      return actualArg === expectedArg
    })

    if (!argsMatch) {
      throw new Error(
        `Expected ${actionName} to be called with ${JSON.stringify(expectedArgs)}, ` +
          `but was called with ${JSON.stringify(lastCall)}`
      )
    }
  }

  /**
   * Send event and assert store action was called
   */
  async transitionAndAssert(
    event: MachineEvent,
    stateMatcher: (state: any) => boolean,
    expectedStoreAction: keyof ReturnType<typeof createMockStore>,
    expectedArgs?: any[]
  ): Promise<void> {
    // Clear previous calls
    const mock = this.mockStore[expectedStoreAction]
    if (mock) {
      mock.mockClear()
    }

    // Send event and wait for state
    await this.machine.sendAndWaitFor(event, stateMatcher)

    // Assert store action was called
    this.assertStoreActionCalled(expectedStoreAction)

    if (expectedArgs) {
      this.assertStoreActionCalledWith(expectedStoreAction, ...expectedArgs)
    }
  }

  /**
   * Clear all mock store action calls
   */
  clearAllMocks(): void {
    Object.values(this.mockStore).forEach((mock) => {
      if (typeof mock === 'function' && 'mockClear' in mock) {
        mock.mockClear()
      }
    })
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.adapter.destroy()
    this.machine.destroy()
  }
}

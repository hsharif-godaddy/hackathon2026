/**
 * Tests for XState Initialization Machine
 *
 * Tests state transitions in isolation without React
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

import { getPhaseFromState, getSubPhaseFromState, initializationMachine } from './initializationMachine'

describe('initializationMachine', () => {
  // -------------------------------------------------------------------------
  // STATE TRANSITIONS - Test transitions in isolation
  // -------------------------------------------------------------------------

  describe('Job Creation Flow', () => {
    it('should transition from idle → checkingCreation → creating → initializingPage', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Start
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')

      // Check if job needs creation
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('checkingCreation')

      // Start creating
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Build me an app' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(true)
      expect(actor.getSnapshot().context.initialPromptText).toBe('Build me an app')

      // Creation succeeds
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('initializingPage')
      expect(actor.getSnapshot().context.realAppId).toBe('app-456')
    })

    it('should retry on creation failure up to max retries', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })

      // First failure - should retry
      actor.send({ type: 'CREATION_FAILED', error: 'Network error' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')
      expect(actor.getSnapshot().context.retryCount).toBe(1)

      // Second failure - should retry
      actor.send({ type: 'CREATION_FAILED', error: 'Network error' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')
      expect(actor.getSnapshot().context.retryCount).toBe(2)

      // Third failure - should retry
      actor.send({ type: 'CREATION_FAILED', error: 'Network error' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')
      expect(actor.getSnapshot().context.retryCount).toBe(3)

      // Fourth failure - should go to error (max retries exceeded)
      actor.send({ type: 'CREATION_FAILED', error: 'Network error' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('error')
      expect(actor.getSnapshot().context.error).toBe('Network error')
    })
  })

  describe('Direct App Flow', () => {
    it('should skip creation and go directly to initializingPage', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-123' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('initializingPage')
    })
  })

  describe('Ready Sub-Phases', () => {
    it('should initialize with hasInitialPrompt from input (hydration)', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: 'app-123', isJobId: false, hasInitialPrompt: true },
      })
      actor.start()

      // Skip to ready state
      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-123' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })

      // Should go to waitingForWebSocket because hasInitialPrompt was hydrated from input
      expect(getPhaseFromState(actor.getSnapshot())).toBe('ready')
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(true)
    })

    it('should transition through WebSocket coordination when hasInitialPrompt', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Fast-forward to ready state with initial prompt
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })

      // Should be waiting for WebSocket
      expect(getPhaseFromState(actor.getSnapshot())).toBe('ready')
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')

      // WebSocket connects
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('websocketConnected')

      // Prompt sent
      actor.send({ type: 'PROMPT_SENT' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')
      expect(actor.getSnapshot().context.initialPromptSent).toBe(true)

      // First file edit seen
      actor.send({ type: 'FIRST_FILE_EDIT_SEEN' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
      expect(actor.getSnapshot().context.hasSeenFirstFileEdit).toBe(true)
    })

    it('should go directly to active when no initial prompt', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Fast-forward without initial prompt
      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-123' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })

      // Should go directly to active (no WebSocket coordination needed)
      expect(getPhaseFromState(actor.getSnapshot())).toBe('ready')
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
    })

    it('should handle WebSocket disconnection during websocketConnected', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Fast-forward to websocketConnected
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      actor.send({ type: 'WEBSOCKET_CONNECTED' })

      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('websocketConnected')

      // Disconnect
      actor.send({ type: 'WEBSOCKET_DISCONNECTED' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')
    })

    it('should NOT allow escape from waitingForFirstEdit on disconnect (overlay stays)', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Fast-forward to waitingForFirstEdit
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      actor.send({ type: 'PROMPT_SENT' })

      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')

      // WebSocket disconnect should NOT transition (intentional - no escape for errors/disconnects)
      actor.send({ type: 'WEBSOCKET_DISCONNECTED' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')

      // FIRST_FILE_EDIT_SEEN escapes to active
      actor.send({ type: 'FIRST_FILE_EDIT_SEEN' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
    })

    it('should transition to active on STREAM_COMPLETE_WITHOUT_FIRST_EDIT (incomplete tool e.g. token limit)', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      actor.send({ type: 'PROMPT_SENT' })

      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')
      expect(actor.getSnapshot().context.hasSeenFirstFileEdit).toBe(false)

      // Stream completed with incomplete tool (e.g. token limit) - hide overlay, show preview
      actor.send({ type: 'STREAM_COMPLETE_WITHOUT_FIRST_EDIT' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
      // Should NOT mark first file edit seen (we only hid overlay for incomplete case)
      expect(actor.getSnapshot().context.hasSeenFirstFileEdit).toBe(false)
    })

    it('should stay in waitingForFirstEdit on AGENT_ACTIVITY (resets failsafe timer)', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      actor.send({ type: 'PROMPT_SENT' })

      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')

      // Agent activity should keep us in waitingForFirstEdit (re-enter resets the after delay)
      actor.send({ type: 'AGENT_ACTIVITY' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')
      expect(actor.getSnapshot().context.hasSeenFirstFileEdit).toBe(false)

      // Can still transition to active via FIRST_FILE_EDIT_SEEN
      actor.send({ type: 'FIRST_FILE_EDIT_SEEN' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
    })

    describe('with fake timers', () => {
      beforeEach(() => vi.useFakeTimers())
      afterEach(() => vi.useRealTimers())

      it('should reset the 10-min failsafe timer on AGENT_ACTIVITY', () => {
        const actor = createActor(initializationMachine, {
          input: { appId: null, isJobId: false, hasInitialPrompt: false },
        })
        actor.start()

        actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
        actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
        actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
        actor.send({ type: 'PAGE_DATA_LOADED' })
        actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
        actor.send({ type: 'WEBSOCKET_CONNECTED' })
        actor.send({ type: 'PROMPT_SENT' })

        expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')

        // Advance 9 minutes (just under the 10-min timeout)
        vi.advanceTimersByTime(9 * 60 * 1000)
        expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')

        // Agent activity at 9 minutes — should reset the timer
        actor.send({ type: 'AGENT_ACTIVITY' })
        expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')

        // Advance another 9 minutes (18 min total, but only 9 since last activity)
        vi.advanceTimersByTime(9 * 60 * 1000)
        expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')

        // Advance 1 more minute (10 min since last activity) — failsafe should fire
        vi.advanceTimersByTime(1 * 60 * 1000)
        expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
        expect(actor.getSnapshot().context.hasSeenFirstFileEdit).toBe(true)

        actor.stop()
      })
    })
  })

  describe('History Loading', () => {
    it('should transition directly to ready on PAGE_DATA_LOADED', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-123' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('ready')
    })
  })

  // -------------------------------------------------------------------------
  // GUARDS - Test conditional transitions
  // -------------------------------------------------------------------------

  describe('Guards', () => {
    it('should respect canRetry guard', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })

      // Fail 4 times (max is 3)
      for (let i = 0; i < 4; i++) {
        actor.send({ type: 'CREATION_FAILED', error: 'Error' })
      }

      expect(getPhaseFromState(actor.getSnapshot())).toBe('error')

      // RETRY_CREATION should NOT work when in error (exceeded max)
      actor.send({ type: 'RETRY_CREATION' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('error') // Still in error
    })
  })

  // -------------------------------------------------------------------------
  // ERROR HANDLING - Test error states
  // -------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should transition to error on FATAL_ERROR from any state', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-123' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('initializingPage')

      actor.send({ type: 'FATAL_ERROR', error: 'Something went terribly wrong' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('error')
      expect(actor.getSnapshot().context.error).toBe('Something went terribly wrong')
    })

    it('should allow RESET from error state', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'FATAL_ERROR', error: 'Test error' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('error')

      actor.send({ type: 'RESET' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')
      expect(actor.getSnapshot().context.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // CONTEXT UPDATES - Test data mutations
  // -------------------------------------------------------------------------

  describe('Context Updates', () => {
    it('should update appId and isJobId on START_CHECKING_CREATION', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      expect(actor.getSnapshot().context.appId).toBe('job-123')
      expect(actor.getSnapshot().context.isJobId).toBe(true)
    })

    it('should initialize with isJobId from input', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: 'job-123', isJobId: true, hasInitialPrompt: false },
      })
      actor.start()

      expect(actor.getSnapshot().context.isJobId).toBe(true)
    })

    it('should update realAppId on CREATION_SUCCEEDED', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })

      expect(actor.getSnapshot().context.realAppId).toBe('app-456')
    })

    it('should track prompt sent state', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      expect(actor.getSnapshot().context.initialPromptSent).toBe(false)

      // Fast-forward
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      actor.send({ type: 'PROMPT_SENT' })

      expect(actor.getSnapshot().context.initialPromptSent).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // RESET AND RE-HYDRATION - Test reset behavior
  // -------------------------------------------------------------------------

  describe('Reset and Re-hydration', () => {
    it('should allow RESET from any state and clear all context', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Go to a non-idle state
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(true)

      // Reset
      actor.send({ type: 'RESET' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(false)
      expect(actor.getSnapshot().context.appId).toBeNull()
      expect(actor.getSnapshot().context.error).toBeNull()
    })

    it('should re-hydrate hasInitialPrompt from START_CHECKING_CREATION event after RESET', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Go through a flow
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(true)

      // Reset
      actor.send({ type: 'RESET' })
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(false)

      // Re-initialize with hydrated state
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-456', isJobId: true, hasInitialPrompt: true })
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(true)
      expect(getPhaseFromState(actor.getSnapshot())).toBe('checkingCreation')
    })

    it('should re-hydrate hasInitialPrompt from SKIP_TO_PAGE_INIT event after RESET', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Reset
      actor.send({ type: 'RESET' })
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(false)

      // Re-initialize with hydrated state (non-job flow)
      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-456', hasInitialPrompt: true })
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(true)
      expect(getPhaseFromState(actor.getSnapshot())).toBe('initializingPage')

      // Complete flow to ready
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })

      // Should go to waitingForWebSocket because hasInitialPrompt was hydrated
      expect(getPhaseFromState(actor.getSnapshot())).toBe('ready')
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')
    })
  })

  // -------------------------------------------------------------------------
  // INTEGRATION - Test complete flows
  // -------------------------------------------------------------------------

  describe('Complete Flows', () => {
    it('should complete full job creation flow with overlay', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Track overlay visibility throughout flow
      function shouldShowOverlay(snapshot: any): boolean {
        const phase = getPhaseFromState(snapshot)
        const subPhase = getSubPhaseFromState(snapshot)
        return (
          phase === 'ready' &&
          snapshot.context.hasInitialPrompt &&
          !snapshot.context.hasSeenFirstFileEdit &&
          (subPhase === 'websocketConnected' || subPhase === 'waitingForFirstEdit')
        )
      }

      // Start
      expect(shouldShowOverlay(actor.getSnapshot())).toBe(false)

      // Job creation
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Build an app' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })

      // Now in ready/waitingForWebSocket - overlay should NOT show yet
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')
      expect(shouldShowOverlay(actor.getSnapshot())).toBe(false)

      // WebSocket connects - overlay should show
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      expect(shouldShowOverlay(actor.getSnapshot())).toBe(true)

      // Prompt sent - overlay still shows
      actor.send({ type: 'PROMPT_SENT' })
      expect(shouldShowOverlay(actor.getSnapshot())).toBe(true)

      // First file edit - overlay clears
      actor.send({ type: 'FIRST_FILE_EDIT_SEEN' })
      expect(shouldShowOverlay(actor.getSnapshot())).toBe(false)
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
    })
  })

  // -------------------------------------------------------------------------
  // EDGE CASES - Test race conditions and unusual sequences
  // -------------------------------------------------------------------------

  describe('Edge Cases: Rapid AppId Changes', () => {
    it('should handle multiple RESET events in quick succession', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Set up initial state
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')

      // Send multiple RESET events rapidly
      actor.send({ type: 'RESET' })
      actor.send({ type: 'RESET' })
      actor.send({ type: 'RESET' })

      // Should be back in idle with clean context
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')
      expect(actor.getSnapshot().context.appId).toBeNull()
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(false)
      expect(actor.getSnapshot().context.initialPromptText).toBeNull()
      expect(actor.getSnapshot().context.error).toBeNull()
    })

    it('should handle RESET during creation in progress', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Start creation
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')

      // RESET while in creating state
      actor.send({ type: 'RESET' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')
      expect(actor.getSnapshot().context.appId).toBeNull()
      expect(actor.getSnapshot().context.initialJobId).toBeNull()
      expect(actor.getSnapshot().context.retryCount).toBe(0)

      // Can start new creation after reset
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-456', isJobId: true })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('checkingCreation')
      expect(actor.getSnapshot().context.appId).toBe('job-456')
    })
  })

  describe('Edge Cases: Race Conditions', () => {
    it('should ignore PAGE_DATA_LOADED arriving after RESET', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Navigate to initializingPage
      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-123' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('initializingPage')

      // RESET (simulating navigation away)
      actor.send({ type: 'RESET' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')

      // Late PAGE_DATA_LOADED arrives (should be ignored in idle state)
      actor.send({ type: 'PAGE_DATA_LOADED' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')
    })

    it('should ignore HISTORY_LOADED arriving after RESET', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-123' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('ready')

      // RESET (simulating navigation away)
      actor.send({ type: 'RESET' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')

      // Late HISTORY_LOADED arrives (should be ignored in idle state)
      actor.send({ type: 'HISTORY_LOADED', hasHistory: true })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')
    })

    it('should handle CREATION_SUCCEEDED arriving after RESET', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Start creation
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')

      // RESET before creation completes
      actor.send({ type: 'RESET' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')

      // Late CREATION_SUCCEEDED arrives (should be ignored in idle state)
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('idle')
      expect(actor.getSnapshot().context.realAppId).toBeNull()
    })
  })

  describe('Edge Cases: WebSocket Connection Instability', () => {
    it('should handle rapid connect/disconnect cycles during waitingForWebSocket', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Navigate to waitingForWebSocket
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')

      // Rapid connect/disconnect/connect
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('websocketConnected')

      actor.send({ type: 'WEBSOCKET_DISCONNECTED' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')

      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('websocketConnected')

      // Should still be able to proceed normally
      actor.send({ type: 'PROMPT_SENT' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')
    })

    it('should handle multiple WEBSOCKET_CONNECTED events in sequence', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Navigate to waitingForWebSocket
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })

      // Multiple WEBSOCKET_CONNECTED events (duplicate events)
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('websocketConnected')

      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('websocketConnected')

      // Should still work normally
      actor.send({ type: 'PROMPT_SENT' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')
    })

    it('should ignore WEBSOCKET_DISCONNECTED when not in websocketConnected state', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Navigate to waitingForWebSocket
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')

      // WEBSOCKET_DISCONNECTED while in waitingForWebSocket (should be ignored)
      actor.send({ type: 'WEBSOCKET_DISCONNECTED' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')
    })
  })

  describe('Edge Cases: Multiple Agent Events', () => {
    it('should handle multiple FIRST_FILE_EDIT_SEEN events', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Navigate to waitingForFirstEdit
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      actor.send({ type: 'PROMPT_SENT' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForFirstEdit')

      // First FIRST_FILE_EDIT_SEEN
      actor.send({ type: 'FIRST_FILE_EDIT_SEEN' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
      expect(actor.getSnapshot().context.hasSeenFirstFileEdit).toBe(true)

      // Duplicate FIRST_FILE_EDIT_SEEN (should be ignored in active state)
      actor.send({ type: 'FIRST_FILE_EDIT_SEEN' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
      expect(actor.getSnapshot().context.hasSeenFirstFileEdit).toBe(true)
    })
  })

  describe('Edge Cases: Job-to-App Conversion', () => {
    it('should handle job-to-app conversion with mismatched realAppId', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Start with job
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      expect(actor.getSnapshot().context.appId).toBe('job-123')
      expect(actor.getSnapshot().context.isJobId).toBe(true)

      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      expect(actor.getSnapshot().context.initialJobId).toBe('job-123')

      // Creation succeeds with different app ID
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-999' })
      expect(actor.getSnapshot().context.realAppId).toBe('app-999')
      expect(actor.getSnapshot().context.appId).toBe('job-123') // Original still tracked
      expect(getPhaseFromState(actor.getSnapshot())).toBe('initializingPage')
    })
  })

  describe('Edge Cases: History Loading', () => {
    it('should be in ready state immediately after PAGE_DATA_LOADED (no loadingHistory gate)', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-123' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('ready')

      // HISTORY_LOADED/HISTORY_TIMEOUT are no-ops — history loads asynchronously in the background
      actor.send({ type: 'HISTORY_LOADED', hasHistory: true })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('ready')
    })
  })

  describe('Edge Cases: Creation Retry Boundary', () => {
    it('should fail at exact retry limit boundary (3 retries)', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })

      // Exactly 3 retries (maxRetries = 3)
      expect(actor.getSnapshot().context.maxRetries).toBe(3)
      expect(actor.getSnapshot().context.retryCount).toBe(0)

      // First failure -> retry (count = 1)
      actor.send({ type: 'CREATION_FAILED', error: 'Error 1' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')
      expect(actor.getSnapshot().context.retryCount).toBe(1)

      // Second failure -> retry (count = 2)
      actor.send({ type: 'CREATION_FAILED', error: 'Error 2' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')
      expect(actor.getSnapshot().context.retryCount).toBe(2)

      // Third failure -> retry (count = 3, at limit)
      actor.send({ type: 'CREATION_FAILED', error: 'Error 3' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')
      expect(actor.getSnapshot().context.retryCount).toBe(3)

      // Fourth failure -> error state (exceeded limit)
      actor.send({ type: 'CREATION_FAILED', error: 'Error 4' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('error')
      expect(actor.getSnapshot().context.retryCount).toBe(3) // No further increment
    })

    it('should succeed after retry without reaching limit', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })

      // Fail once
      actor.send({ type: 'CREATION_FAILED', error: 'Transient error' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('creating')
      expect(actor.getSnapshot().context.retryCount).toBe(1)

      // Succeed on retry
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      expect(getPhaseFromState(actor.getSnapshot())).toBe('initializingPage')
      expect(actor.getSnapshot().context.retryCount).toBe(0) // Reset on success
    })
  })

  describe('Edge Cases: Out of Order Events', () => {
    it('should release the lock on PROMPT_SENT in waitingForWebSocket without advancing state', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Navigate to waitingForWebSocket
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')

      // PROMPT_SENT in waitingForWebSocket is the auto-send catch race path:
      // ws.actions.send rejected after the socket dropped. The handler must flip
      // initialPromptSent so deriveIsAwaitingStream releases the chat input lock,
      // but stay in waitingForWebSocket because we are not actually waiting for an edit.
      actor.send({ type: 'PROMPT_SENT' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')
      expect(actor.getSnapshot().context.initialPromptSent).toBe(true)

      // On reconnect, machine advances normally; no double-send because shouldAutoSendPrompt
      // requires !initialPromptSent (validated in useInitialization).
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('websocketConnected')
    })

    it('should ignore FIRST_FILE_EDIT_SEEN in wrong state', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Navigate to waitingForWebSocket
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')

      // FIRST_FILE_EDIT_SEEN arrives early (should be ignored)
      actor.send({ type: 'FIRST_FILE_EDIT_SEEN' })
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')
      expect(actor.getSnapshot().context.hasSeenFirstFileEdit).toBe(false)
    })
  })

  describe('Edge Cases: Complete Phase Transitions', () => {
    it('should transition through all phases without errors (job flow)', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      const phases: string[] = []
      const subPhases: (string | null)[] = []

      function recordState() {
        const snapshot = actor.getSnapshot()
        phases.push(getPhaseFromState(snapshot))
        subPhases.push(getSubPhaseFromState(snapshot))
      }

      recordState() // idle

      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      recordState() // checkingCreation

      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Test' })
      recordState() // creating

      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      recordState() // initializingPage

      actor.send({ type: 'PAGE_DATA_LOADED' })
      recordState() // ready/waitingForWebSocket

      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      recordState() // ready/websocketConnected

      actor.send({ type: 'PROMPT_SENT' })
      recordState() // ready/waitingForFirstEdit

      actor.send({ type: 'FIRST_FILE_EDIT_SEEN' })
      recordState() // ready/active

      expect(phases).toEqual([
        'idle',
        'checkingCreation',
        'creating',
        'initializingPage',
        'ready',
        'ready',
        'ready',
        'ready',
      ])

      expect(subPhases).toEqual([
        null,
        null,
        null,
        null,
        'waitingForWebSocket',
        'websocketConnected',
        'waitingForFirstEdit',
        'active',
      ])
    })

    it('should transition through all phases without errors (direct app flow)', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      const phases: string[] = []

      function recordState() {
        phases.push(getPhaseFromState(actor.getSnapshot()))
      }

      recordState() // idle

      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-123' })
      recordState() // initializingPage

      actor.send({ type: 'PAGE_DATA_LOADED' })
      recordState() // ready (no loadingHistory gate — history loads async in background)

      expect(phases).toEqual(['idle', 'initializingPage', 'ready'])
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
    })
  })

  describe('Edge Cases: Context Preservation', () => {
    it('should preserve context values across state transitions', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Start creation
      actor.send({ type: 'START_CHECKING_CREATION', appId: 'job-123', isJobId: true })
      expect(actor.getSnapshot().context.appId).toBe('job-123')

      actor.send({ type: 'START_CREATING', jobId: 'job-123', initialPromptText: 'Build me an app' })
      expect(actor.getSnapshot().context.initialPromptText).toBe('Build me an app')
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(true)

      actor.send({ type: 'CREATION_SUCCEEDED', realAppId: 'app-456' })
      // Context should persist
      expect(actor.getSnapshot().context.appId).toBe('job-123')
      expect(actor.getSnapshot().context.realAppId).toBe('app-456')
      expect(actor.getSnapshot().context.initialPromptText).toBe('Build me an app')

      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })
      actor.send({ type: 'WEBSOCKET_CONNECTED' })
      // Context still preserved
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(true)
      expect(actor.getSnapshot().context.initialPromptText).toBe('Build me an app')

      actor.send({ type: 'PROMPT_SENT' })
      expect(actor.getSnapshot().context.initialPromptSent).toBe(true)

      actor.send({ type: 'FIRST_FILE_EDIT_SEEN' })
      expect(actor.getSnapshot().context.hasSeenFirstFileEdit).toBe(true)
      // All context still intact
      expect(actor.getSnapshot().context.appId).toBe('job-123')
      expect(actor.getSnapshot().context.realAppId).toBe('app-456')
    })
  })

  describe('Edge Cases: Input Hydration', () => {
    it('should handle input with appId: null, isJobId: false, hasInitialPrompt: false', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      expect(actor.getSnapshot().context.appId).toBeNull()
      expect(actor.getSnapshot().context.isJobId).toBe(false)
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(false)
    })

    it('should handle input with appId: string, isJobId: true, hasInitialPrompt: true', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: 'job-123', isJobId: true, hasInitialPrompt: true },
      })
      actor.start()

      expect(actor.getSnapshot().context.appId).toBe('job-123')
      expect(actor.getSnapshot().context.isJobId).toBe(true)
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(true)
    })

    it('should handle input with appId: string, isJobId: false, hasInitialPrompt: true', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: 'app-456', isJobId: false, hasInitialPrompt: true },
      })
      actor.start()

      // Skip to ready state to see sub-phase behavior
      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-456' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })

      // Should go to waitingForWebSocket because hasInitialPrompt is true
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('waitingForWebSocket')
    })

    it('should handle input with appId: string, isJobId: false, hasInitialPrompt: false', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: 'app-789', isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      // Skip to ready state to see sub-phase behavior
      actor.send({ type: 'SKIP_TO_PAGE_INIT', appId: 'app-789' })
      actor.send({ type: 'PAGE_DATA_LOADED' })
      actor.send({ type: 'HISTORY_LOADED', hasHistory: false })

      // Should go directly to active because hasInitialPrompt is false
      expect(getSubPhaseFromState(actor.getSnapshot())).toBe('active')
    })

    it('should handle input with all null/false values', () => {
      const actor = createActor(initializationMachine, {
        input: { appId: null, isJobId: false, hasInitialPrompt: false },
      })
      actor.start()

      expect(actor.getSnapshot().context.appId).toBeNull()
      expect(actor.getSnapshot().context.isJobId).toBe(false)
      expect(actor.getSnapshot().context.hasInitialPrompt).toBe(false)
      expect(actor.getSnapshot().context.initialJobId).toBeNull()
      expect(actor.getSnapshot().context.realAppId).toBeNull()
      expect(actor.getSnapshot().context.initialPromptText).toBeNull()
      expect(actor.getSnapshot().context.initialPromptSent).toBe(false)
      expect(actor.getSnapshot().context.hasSeenFirstFileEdit).toBe(false)
      expect(actor.getSnapshot().context.error).toBeNull()
      expect(actor.getSnapshot().context.retryCount).toBe(0)
    })
  })
})

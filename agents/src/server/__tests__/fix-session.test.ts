import { describe, it, expect, vi } from 'vitest'

import {
  agentAskedQuestion,
  agentMadeCodeChanges,
  manageFixSessionLifecycle,
  FIX_SESSION_END_CONFIDENCE,
  FIX_SESSION_MAX_TURNS,
} from '../fix-session.js'
import { LifecycleSessionStore } from '../message-lifecycle.js'
import { AssessmentReason, AssessmentTaskType, ConversationRole, FixSessionPhase } from '../../agents/assessment-agent/index.js'
import type { AssessmentOutcome } from '../../agents/assessment-agent/index.js'
import type { ExecutionStep } from '@airo/ai-lib/budget'

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

function makeOutcome(
  taskType: 'fix' | 'general' | 'publish' | 'domain',
  confidence: number,
  reasoning?: string,
): AssessmentOutcome {
  return {
    result: { taskType: taskType as AssessmentTaskType, confidence, reasoning },
    overrideApplied: taskType !== 'general' && confidence >= 65,
    appliedBudget: taskType !== 'general' && confidence >= 65 ? `airo-builder:${taskType}-task` : undefined,
    durationMs: 100,
    completedInTime: true,
    reason: AssessmentReason.LlmCompleted,
  } as AssessmentOutcome
}

function makeStep(toolName: string, input?: unknown): ExecutionStep {
  return {
    content: [{
      type: 'tool-call' as const,
      toolName,
      toolCallId: 'tc-1',
      input,
    }],
  }
}

describe('agentAskedQuestion', () => {
  it('returns true when askQuestion tool was called', () => {
    const steps = [makeStep('askQuestion', { question: 'What browser?' })]
    expect(agentAskedQuestion(steps)).toBe(true)
  })

  it('returns true when suggestedResponse tool was called', () => {
    const steps = [makeStep('suggestedResponse', { question: 'Pick one' })]
    expect(agentAskedQuestion(steps)).toBe(true)
  })

  it('returns false when only code tools were called', () => {
    const steps = [makeStep('str_replace_based_edit_tool', { command: 'str_replace' })]
    expect(agentAskedQuestion(steps)).toBe(false)
  })

  it('returns false for empty steps', () => {
    expect(agentAskedQuestion([])).toBe(false)
  })

  it('returns false when toolName is null', () => {
    const steps: ExecutionStep[] = [{ content: [{ type: 'tool-call', toolName: undefined }] }]
    expect(agentAskedQuestion(steps)).toBe(false)
  })
})

describe('agentMadeCodeChanges', () => {
  it('returns true for str_replace command', () => {
    const steps = [makeStep('str_replace_based_edit_tool', { command: 'str_replace', path: '/a.ts' })]
    expect(agentMadeCodeChanges(steps)).toBe(true)
  })

  it('returns true for insert command', () => {
    const steps = [makeStep('str_replace_based_edit_tool', { command: 'insert', path: '/a.ts' })]
    expect(agentMadeCodeChanges(steps)).toBe(true)
  })

  it('returns true for create command', () => {
    const steps = [makeStep('str_replace_based_edit_tool', { command: 'create', path: '/new.ts' })]
    expect(agentMadeCodeChanges(steps)).toBe(true)
  })

  it('returns false for view command (read-only)', () => {
    const steps = [makeStep('str_replace_based_edit_tool', { command: 'view', path: '/a.ts' })]
    expect(agentMadeCodeChanges(steps)).toBe(false)
  })

  it('returns true for write_to_file (WRITE_TOOLS)', () => {
    const steps = [makeStep('write_to_file', { path: '/new-file.ts', content: '...' })]
    expect(agentMadeCodeChanges(steps)).toBe(true)
  })

  it('returns true when command is undefined (assumes edit per ai-lib convention)', () => {
    const steps = [makeStep('str_replace_based_edit_tool', null)]
    expect(agentMadeCodeChanges(steps)).toBe(true)
  })

  it('returns false for non-edit tools', () => {
    const steps = [makeStep('readFile', { path: '/a.ts' })]
    expect(agentMadeCodeChanges(steps)).toBe(false)
  })

  it('returns false for empty steps', () => {
    expect(agentMadeCodeChanges([])).toBe(false)
  })
})

describe('manageFixSessionLifecycle', () => {
  function setup() {
    const store = new LifecycleSessionStore()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    return { store, logger }
  }

  describe('session activation', () => {
    it('activates fix session when classified as Fix with confidence >= 65', () => {
      const { store, logger } = setup()
      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', makeOutcome('fix', 85))

      expect(store.isFixSessionActive('sess-1')).toBe(true)
      expect(store.getFixSessionPhase('sess-1')).toBe(FixSessionPhase.Gathering)
      expect(logger.info).toHaveBeenCalledWith('fix_session.activated', expect.objectContaining({
        appId: 'app-1', sessionKey: 'sess-1', confidence: 85,
      }))
    })

    it('does not activate when confidence is below threshold', () => {
      const { store, logger } = setup()
      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', makeOutcome('fix', 50))

      expect(store.isFixSessionActive('sess-1')).toBe(false)
    })

    it('does not activate for General classification', () => {
      const { store, logger } = setup()
      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', makeOutcome('general', 90))

      expect(store.isFixSessionActive('sess-1')).toBe(false)
    })

    it('does not activate when result is null', () => {
      const { store, logger } = setup()
      const outcome: AssessmentOutcome = {
        result: null, overrideApplied: false, durationMs: 100,
        completedInTime: true, reason: AssessmentReason.Error,
      }
      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', outcome)

      expect(store.isFixSessionActive('sess-1')).toBe(false)
    })
  })

  describe('turn guard', () => {
    it('ends session after FIX_SESSION_MAX_TURNS total turns (including activation)', () => {
      const { store, logger } = setup()
      store.activateFixSession('sess-1') // turnCount starts at 1 (activation turn)

      // Each call to manageFixSessionLifecycle increments turnCount.
      // With MAX_TURNS=5: activation=1, then increments to 2,3,4 are safe, 5 triggers guard.
      for (let i = 0; i < FIX_SESSION_MAX_TURNS - 2; i++) {
        manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', makeOutcome('fix', 80))
        expect(store.isFixSessionActive('sess-1')).toBe(true)
      }

      // This turn should trigger the guard (turnCount reaches FIX_SESSION_MAX_TURNS)
      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', makeOutcome('fix', 80))
      expect(store.isFixSessionActive('sess-1')).toBe(false)
      expect(logger.info).toHaveBeenCalledWith('fix_session.ended.turn_guard', expect.objectContaining({
        appId: 'app-1', sessionKey: 'sess-1',
      }))
    })
  })

  describe('attempted phase transitions', () => {
    it('ends session on General with confidence >= 80 in attempted phase', () => {
      const { store, logger } = setup()
      store.activateFixSession('sess-1')
      store.transitionToAttempted('sess-1')

      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1',
        makeOutcome('general', FIX_SESSION_END_CONFIDENCE, 'user said thanks'))

      expect(store.isFixSessionActive('sess-1')).toBe(false)
      expect(logger.info).toHaveBeenCalledWith('fix_session.ended.topic_change', expect.objectContaining({
        haikuConfidence: FIX_SESSION_END_CONFIDENCE,
        haikuReasoning: 'user said thanks',
        phase: FixSessionPhase.Attempted,
      }))
    })

    it('transitions back to gathering on Fix in attempted phase (still broken)', () => {
      const { store, logger } = setup()
      store.activateFixSession('sess-1')
      store.transitionToAttempted('sess-1')

      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1',
        makeOutcome('fix', 82, 'user reports still broken'))

      expect(store.isFixSessionActive('sess-1')).toBe(true)
      expect(store.getFixSessionPhase('sess-1')).toBe(FixSessionPhase.Gathering)
      expect(logger.info).toHaveBeenCalledWith('fix_session.phase.gathering_retry', expect.objectContaining({
        haikuReasoning: 'user reports still broken',
      }))
    })

    it('stays in attempted when General confidence < 80', () => {
      const { store, logger } = setup()
      store.activateFixSession('sess-1')
      store.transitionToAttempted('sess-1')

      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', makeOutcome('general', 60))

      expect(store.isFixSessionActive('sess-1')).toBe(true)
      expect(store.getFixSessionPhase('sess-1')).toBe(FixSessionPhase.Attempted)
    })

    it('does NOT end session when General >= 80 is from a Haiku timeout (not a deliberate classification)', () => {
      const { store, logger } = setup()
      store.activateFixSession('sess-1')
      store.transitionToAttempted('sess-1')

      const timeoutOutcome: AssessmentOutcome = {
        result: { taskType: 'general' as AssessmentTaskType, confidence: 100 },
        overrideApplied: false,
        durationMs: 3500,
        completedInTime: false,
        reason: AssessmentReason.Timeout,
      }
      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', timeoutOutcome)

      expect(store.isFixSessionActive('sess-1')).toBe(true)
      expect(store.getFixSessionPhase('sess-1')).toBe(FixSessionPhase.Attempted)
    })

    it('does NOT end session when General >= 80 is from an embedding timeout fallback (Haiku skipped)', () => {
      const { store, logger } = setup()
      store.activateFixSession('sess-1')
      store.transitionToAttempted('sess-1')

      const fallbackOutcome: AssessmentOutcome = {
        result: { taskType: 'general' as AssessmentTaskType, confidence: 100 },
        overrideApplied: false,
        durationMs: 3456,
        completedInTime: true,
        reason: AssessmentReason.EmbeddingTimeoutFallback,
      }
      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', fallbackOutcome)

      expect(store.isFixSessionActive('sess-1')).toBe(true)
      expect(store.getFixSessionPhase('sess-1')).toBe(FixSessionPhase.Attempted)
    })
  })

  describe('gathering phase', () => {
    it('does not change phase on Fix classification (stays gathering)', () => {
      const { store, logger } = setup()
      store.activateFixSession('sess-1')

      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', makeOutcome('fix', 85))

      expect(store.getFixSessionPhase('sess-1')).toBe(FixSessionPhase.Gathering)
    })

    it('does not change phase on General classification (stays gathering)', () => {
      const { store, logger } = setup()
      store.activateFixSession('sess-1')

      manageFixSessionLifecycle(store, logger, 'sess-1', 'app-1', makeOutcome('general', 70))

      expect(store.getFixSessionPhase('sess-1')).toBe(FixSessionPhase.Gathering)
    })
  })

  describe('feature flag gating', () => {
    it('does not interfere with sessions from different keys', () => {
      const { store, logger } = setup()
      store.activateFixSession('sess-1')

      manageFixSessionLifecycle(store, logger, 'sess-2', 'app-1', makeOutcome('fix', 90))

      expect(store.isFixSessionActive('sess-1')).toBe(true)
      expect(store.isFixSessionActive('sess-2')).toBe(true)
    })
  })
})

describe('LifecycleSessionStore fix session methods', () => {
  it('starts inactive', () => {
    const store = new LifecycleSessionStore()
    expect(store.isFixSessionActive('s')).toBe(false)
    expect(store.getFixSessionPhase('s')).toBeUndefined()
  })

  it('activateFixSession sets phase to Gathering and turnCount to 1', () => {
    const store = new LifecycleSessionStore()
    store.activateFixSession('s')

    expect(store.isFixSessionActive('s')).toBe(true)
    expect(store.getFixSessionPhase('s')).toBe(FixSessionPhase.Gathering)
    expect(store.getFixSessionTurnCount('s')).toBe(1)
  })

  it('transitionToAttempted changes phase', () => {
    const store = new LifecycleSessionStore()
    store.activateFixSession('s')
    store.transitionToAttempted('s')

    expect(store.getFixSessionPhase('s')).toBe(FixSessionPhase.Attempted)
  })

  it('transitionToGathering changes phase back', () => {
    const store = new LifecycleSessionStore()
    store.activateFixSession('s')
    store.transitionToAttempted('s')
    store.transitionToGathering('s')

    expect(store.getFixSessionPhase('s')).toBe(FixSessionPhase.Gathering)
  })

  it('deactivateFixSession clears all fix session state including recentTurns', () => {
    const store = new LifecycleSessionStore()
    store.activateFixSession('s')
    store.pushTurn('s', { role: ConversationRole.user, content: 'msg1' })
    store.incrementFixSessionTurns('s')

    store.deactivateFixSession('s')

    expect(store.isFixSessionActive('s')).toBe(false)
    expect(store.getFixSessionPhase('s')).toBeUndefined()
    expect(store.getFixSessionTurnCount('s')).toBe(0)
    expect(store.getRecentTurns('s')).toEqual([])
  })

  it('incrementFixSessionTurns increments and returns new count', () => {
    const store = new LifecycleSessionStore()
    store.activateFixSession('s') // starts at 1

    expect(store.incrementFixSessionTurns('s')).toBe(2)
    expect(store.incrementFixSessionTurns('s')).toBe(3)
  })

  it('pushTurn maintains sliding window of 6', () => {
    const store = new LifecycleSessionStore()
    store.pushTurn('s', { role: ConversationRole.user, content: 'msg1' })
    store.pushTurn('s', { role: ConversationRole.agent, content: 'msg1' })
    store.pushTurn('s', { role: ConversationRole.user, content: 'msg2' })
    store.pushTurn('s', { role: ConversationRole.agent, content: 'msg2' })
    store.pushTurn('s', { role: ConversationRole.user, content: 'msg3' })
    store.pushTurn('s', { role: ConversationRole.agent, content: 'msg3' })

    expect(store.getRecentTurns('s')).toEqual([
      { role: 'user', content: 'msg1' },
      { role: 'agent', content: 'msg1' },
      { role: 'user', content: 'msg2' },
      { role: 'agent', content: 'msg2' },
      { role: 'user', content: 'msg3' },
      { role: 'agent', content: 'msg3' },
    ])

    store.pushTurn('s', { role: ConversationRole.user, content: 'msg4' })
    store.pushTurn('s', { role: ConversationRole.agent, content: 'msg4' })
    expect(store.getRecentTurns('s')).toEqual([
      { role: ConversationRole.user, content: 'msg2' },
      { role: ConversationRole.agent, content: 'msg2' },
      { role: ConversationRole.user, content: 'msg3' },
      { role: ConversationRole.agent, content: 'msg3' },
      { role: ConversationRole.user, content: 'msg4' },
      { role: ConversationRole.agent, content: 'msg4' },
    ])
  })

  it('clearTurnState clears only ephemeral per-turn data, preserves fix session and agent signals', () => {
    const store = new LifecycleSessionStore()
    store.setLastUserMessage('s', 'msg')
    store.setLastAssessmentTaskType('s', 'fix' as any)
    store.activateFixSession('s')
    store.pushTurn('s', { role: ConversationRole.user, content: 'msg1' })
    store.setLastTurnAgentAskedQuestion('s', true)
    store.setLastTurnAgentMadeCodeChanges('s', true)

    store.clearTurnState('s')

    expect(store.getLastUserMessage('s')).toBeUndefined()
    expect(store.getLastAssessmentTaskType('s')).toBeUndefined()
    // Agent signal flags persist across the turn boundary (read by next turn's classification)
    expect(store.didLastTurnAgentAskQuestion('s')).toBe(true)
    expect(store.didLastTurnAgentMakeCodeChanges('s')).toBe(true)
    // Fix session state persists
    expect(store.isFixSessionActive('s')).toBe(true)
    expect(store.getFixSessionPhase('s')).toBe(FixSessionPhase.Gathering)
    expect(store.getRecentTurns('s')).toEqual([{ role: ConversationRole.user, content: 'msg1' }])
  })

  it('clearSession clears all state including fix session (full teardown)', () => {
    const store = new LifecycleSessionStore()
    store.setLastUserMessage('s', 'msg')
    store.setLastAssessmentTaskType('s', 'fix' as any)
    store.activateFixSession('s')
    store.pushTurn('s', { role: ConversationRole.user, content: 'msg1' })

    store.clearSession('s')

    expect(store.getLastUserMessage('s')).toBeUndefined()
    expect(store.getLastAssessmentTaskType('s')).toBeUndefined()
    expect(store.isFixSessionActive('s')).toBe(false)
    expect(store.getRecentTurns('s')).toEqual([])
  })

  it('tracks lastTurnAgentMadeCodeChanges', () => {
    const store = new LifecycleSessionStore()
    expect(store.didLastTurnAgentMakeCodeChanges('s')).toBe(false)

    store.setLastTurnAgentMadeCodeChanges('s', true)
    expect(store.didLastTurnAgentMakeCodeChanges('s')).toBe(true)

    store.setLastTurnAgentMadeCodeChanges('s', false)
    expect(store.didLastTurnAgentMakeCodeChanges('s')).toBe(false)
  })

  it('deactivateFixSession clears lastTurnAgentMadeCodeChanges', () => {
    const store = new LifecycleSessionStore()
    store.activateFixSession('s')
    store.setLastTurnAgentMadeCodeChanges('s', true)

    store.deactivateFixSession('s')
    expect(store.didLastTurnAgentMakeCodeChanges('s')).toBe(false)
  })
})

describe('post-execution phase transition (gathering → attempted)', () => {
  it('transitions to attempted when agent made code changes without asking a question', () => {
    const store = new LifecycleSessionStore()
    store.activateFixSession('s')

    const steps = [makeStep('str_replace_based_edit_tool', { command: 'str_replace', path: '/a.ts' })]
    const asked = agentAskedQuestion(steps)
    const madeChanges = agentMadeCodeChanges(steps)

    expect(asked).toBe(false)
    expect(madeChanges).toBe(true)

    if (store.getFixSessionPhase('s') === FixSessionPhase.Gathering && madeChanges && !asked) {
      store.transitionToAttempted('s')
    }

    expect(store.getFixSessionPhase('s')).toBe(FixSessionPhase.Attempted)
  })

  it('stays in gathering when agent asked a question alongside code changes', () => {
    const store = new LifecycleSessionStore()
    store.activateFixSession('s')

    const steps = [
      makeStep('str_replace_based_edit_tool', { command: 'str_replace', path: '/a.ts' }),
      makeStep('askQuestion', { question: 'Does this look right?' }),
    ]
    const asked = agentAskedQuestion(steps)
    const madeChanges = agentMadeCodeChanges(steps)

    expect(asked).toBe(true)
    expect(madeChanges).toBe(true)

    if (store.getFixSessionPhase('s') === FixSessionPhase.Gathering && madeChanges && !asked) {
      store.transitionToAttempted('s')
    }

    expect(store.getFixSessionPhase('s')).toBe(FixSessionPhase.Gathering)
  })

  it('stays in gathering when agent only searched/read (no code changes, no question)', () => {
    const store = new LifecycleSessionStore()
    store.activateFixSession('s')

    const steps = [makeStep('readFile', { path: '/a.ts' })]
    const asked = agentAskedQuestion(steps)
    const madeChanges = agentMadeCodeChanges(steps)

    expect(asked).toBe(false)
    expect(madeChanges).toBe(false)

    if (store.getFixSessionPhase('s') === FixSessionPhase.Gathering && madeChanges && !asked) {
      store.transitionToAttempted('s')
    }

    expect(store.getFixSessionPhase('s')).toBe(FixSessionPhase.Gathering)
  })

  it('does not transition when already in attempted phase', () => {
    const store = new LifecycleSessionStore()
    store.activateFixSession('s')
    store.transitionToAttempted('s')

    const steps = [makeStep('str_replace_based_edit_tool', { command: 'str_replace', path: '/a.ts' })]
    const asked = agentAskedQuestion(steps)
    const madeChanges = agentMadeCodeChanges(steps)

    if (store.getFixSessionPhase('s') === FixSessionPhase.Gathering && madeChanges && !asked) {
      store.transitionToAttempted('s')
    }

    expect(store.getFixSessionPhase('s')).toBe(FixSessionPhase.Attempted)
  })
})



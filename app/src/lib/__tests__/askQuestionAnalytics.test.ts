import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockShip = vi.fn()
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (event: string, data: Record<string, unknown>) => mockShip(event, data),
}))

import {
  generateFlowId,
  trackFlowCompleted,
  trackFlowStarted,
  trackNavigatorClicked,
  trackQuestionAnswered,
  trackQuestionShown,
  trackQuestionSkipped,
} from '../askQuestionAnalytics'

const ctx = { flowId: 'flow-1', appCreation: true, endgameCohort: 'initial_agent_v3' }

describe('askQuestionAnalytics', () => {
  beforeEach(() => mockShip.mockReset())

  it('flow_started carries flow_id, app_creation, endgame_cohort, total_questions', () => {
    trackFlowStarted(ctx, 3)
    expect(mockShip).toHaveBeenCalledWith('ask_question.flow_started', {
      flow_id: 'flow-1',
      app_creation: true,
      endgame_cohort: 'initial_agent_v3',
      total_questions: 3,
    })
  })

  it('question_shown carries position', () => {
    trackQuestionShown(ctx, 2)
    expect(mockShip).toHaveBeenCalledWith('ask_question.question_shown', {
      flow_id: 'flow-1',
      app_creation: true,
      endgame_cohort: 'initial_agent_v3',
      position: 2,
    })
  })

  it('question_answered carries position', () => {
    trackQuestionAnswered(ctx, 1)
    expect(mockShip).toHaveBeenCalledWith('ask_question.question_answered', {
      flow_id: 'flow-1',
      app_creation: true,
      endgame_cohort: 'initial_agent_v3',
      position: 1,
    })
  })

  it('question_skipped carries position', () => {
    trackQuestionSkipped(ctx, 1)
    expect(mockShip).toHaveBeenCalledWith('ask_question.question_skipped', {
      flow_id: 'flow-1',
      app_creation: true,
      endgame_cohort: 'initial_agent_v3',
      position: 1,
    })
  })

  it('navigator_clicked carries position and direction', () => {
    trackNavigatorClicked(ctx, 2, 'back')
    expect(mockShip).toHaveBeenCalledWith('ask_question.navigator_clicked', {
      flow_id: 'flow-1',
      app_creation: true,
      endgame_cohort: 'initial_agent_v3',
      position: 2,
      direction: 'back',
    })
  })

  it('navigator_clicked carries the forward direction', () => {
    trackNavigatorClicked(ctx, 1, 'forward')
    expect(mockShip).toHaveBeenCalledWith('ask_question.navigator_clicked', {
      flow_id: 'flow-1',
      app_creation: true,
      endgame_cohort: 'initial_agent_v3',
      position: 1,
      direction: 'forward',
    })
  })

  it('flow_completed carries only base props', () => {
    trackFlowCompleted(ctx)
    expect(mockShip).toHaveBeenCalledWith('ask_question.flow_completed', {
      flow_id: 'flow-1',
      app_creation: true,
      endgame_cohort: 'initial_agent_v3',
    })
  })

  it('omits endgame_cohort when not provided', () => {
    trackFlowCompleted({ flowId: 'f2', appCreation: false })
    expect(mockShip).toHaveBeenCalledWith('ask_question.flow_completed', {
      flow_id: 'f2',
      app_creation: false,
    })
  })

  it('generateFlowId returns a non-empty unique string', () => {
    const a = generateFlowId()
    const b = generateFlowId()
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(0)
    expect(a).not.toBe(b)
  })
})

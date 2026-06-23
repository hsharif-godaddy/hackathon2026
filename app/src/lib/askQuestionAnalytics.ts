import { shipAnalyticsLog } from '@/lib/logging'

/** Event names sent to shipAnalyticsLog; land in ES as `client.ask_question.*`. */
export const ASK_QUESTION_EVENTS = {
  flowStarted: 'ask_question.flow_started',
  questionShown: 'ask_question.question_shown',
  questionAnswered: 'ask_question.question_answered',
  questionSkipped: 'ask_question.question_skipped',
  navigatorClicked: 'ask_question.navigator_clicked',
  flowCompleted: 'ask_question.flow_completed',
} as const

export type NavigatorDirection = 'back' | 'forward'

/** Stamped on every askQuestion event. One flow = one on-screen question set. */
export interface AskQuestionFlowContext {
  flowId: string
  appCreation: boolean
  endgameCohort?: string
}

/** Stable unique id for one question set. Falls back when crypto.randomUUID is unavailable. */
export function generateFlowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `aqf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function baseProps(ctx: AskQuestionFlowContext): Record<string, unknown> {
  return {
    flow_id: ctx.flowId,
    app_creation: ctx.appCreation,
    ...(ctx.endgameCohort ? { endgame_cohort: ctx.endgameCohort } : {}),
  }
}

export function trackFlowStarted(ctx: AskQuestionFlowContext, totalQuestions: number): void {
  shipAnalyticsLog(ASK_QUESTION_EVENTS.flowStarted, { ...baseProps(ctx), total_questions: totalQuestions })
}

export function trackQuestionShown(ctx: AskQuestionFlowContext, position: number): void {
  shipAnalyticsLog(ASK_QUESTION_EVENTS.questionShown, { ...baseProps(ctx), position })
}

export function trackQuestionAnswered(ctx: AskQuestionFlowContext, position: number): void {
  shipAnalyticsLog(ASK_QUESTION_EVENTS.questionAnswered, { ...baseProps(ctx), position })
}

export function trackQuestionSkipped(ctx: AskQuestionFlowContext, position: number): void {
  shipAnalyticsLog(ASK_QUESTION_EVENTS.questionSkipped, { ...baseProps(ctx), position })
}

export function trackNavigatorClicked(
  ctx: AskQuestionFlowContext,
  position: number,
  direction: NavigatorDirection,
): void {
  shipAnalyticsLog(ASK_QUESTION_EVENTS.navigatorClicked, { ...baseProps(ctx), position, direction })
}

export function trackFlowCompleted(ctx: AskQuestionFlowContext): void {
  shipAnalyticsLog(ASK_QUESTION_EVENTS.flowCompleted, baseProps(ctx))
}

import { AssessmentTaskType } from './types.js'
import { BudgetOverride } from '@airo/ai-grants'

/**
 * Keyword patterns for task classification hints
 * Order defines priority: first match wins for multi-intent prompts
 * Fix is checked first (higher priority than publish/domain)
 */
const KEYWORD_PATTERN_ORDER: Array<{ taskType: Exclude<AssessmentTaskType, AssessmentTaskType.General>; patterns: RegExp[] }> = [
  // Fix has highest priority - if user mentions fixing AND publishing, they need to fix first
  {
    taskType: AssessmentTaskType.Fix,
    patterns: [
      /\bfix\b/i,
      /\bbroken\b/i,
      /\bnot\s*working\b/i,
      /\berror\b/i,
      /\bbug\b/i,
      /\bcrash/i,
      /\bfailing\b/i,
      /\bissue\b/i,
    ],
  },
  {
    taskType: AssessmentTaskType.Publish,
    patterns: [
      /\bpublish\b/i,
      /\bdeploy\b/i,
      /\bgo\s*live\b/i,
      /\bpush\s*to\s*prod/i,
      /\blaunch\b/i,
      /\brelease\b/i,
      /\bmake\s*(it\s*)?live\b/i,
    ],
  },
  {
    taskType: AssessmentTaskType.Domain,
    patterns: [
      /\bdomain\b/i,
      /\bcustom\s*domain\b/i,
      /\battach\s*domain\b/i,
      /\bconnect\s*(my\s*)?domain\b/i,
      /\bbuy\s*(a\s*)?domain\b/i,
    ],
  },
]

// Derived map for backward compatibility (used in system prompt hints)
export const KEYWORD_PATTERNS: Record<Exclude<AssessmentTaskType, AssessmentTaskType.General>, RegExp[]> =
  Object.fromEntries(KEYWORD_PATTERN_ORDER.map(({ taskType, patterns }) => [taskType, patterns])) as Record<
    Exclude<AssessmentTaskType, AssessmentTaskType.General>,
    RegExp[]
  >

export const TASK_BUDGET_MAP: Record<AssessmentTaskType, BudgetOverride | null> = {
  [AssessmentTaskType.Publish]: BudgetOverride.PublishTask,
  [AssessmentTaskType.Domain]: BudgetOverride.DomainTask,
  [AssessmentTaskType.Fix]: BudgetOverride.FixTask,
  [AssessmentTaskType.General]: null,
}

/**
 * Match keywords in prompt to determine task type hint
 * Uses ordered iteration to ensure deterministic priority (Fix > Publish > Domain)
 */
export function matchKeywords(prompt: string): { taskType: AssessmentTaskType; keywords: string[] } | null {
  for (const { taskType, patterns } of KEYWORD_PATTERN_ORDER) {
    const matchedPatterns = patterns.filter((p) => p.test(prompt))
    if (matchedPatterns.length > 0) {
      return {
        taskType,
        keywords: matchedPatterns.map((p) => p.source),
      }
    }
  }
  return null
}

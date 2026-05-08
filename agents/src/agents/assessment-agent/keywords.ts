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
 * Lexical negation across locales. Embeddings conflate commands with negated commands,
 * so classifiers detect negation with explicit word lists (same pattern set for LR + embedding paths).
 */
export const NEGATION_PATTERNS = new RegExp(
  '(' +
    "\\b(don'?t|do not|never|stop|cancel|wait|later|not yet|hold off)\\b" +
    "|(it'?s not|its not|isn'?t)(?! working| loading| saving| submitting| showing| displaying| responding| functioning| connecting)" +
    '|\\b(no quiero|no lo hagas|todavía no|espera|cancelar|más tarde|nunca)\\b' +
    "|\\b(ne pas|pas encore|annuler|attendre|plus tard|jamais)\\b" +
    '|\\b(nicht|noch nicht|warte|abbrechen|später|niemals)\\b' +
    '|\\b(não|ainda não|espere|cancelar|mais tarde|nunca)\\b' +
    '|\\b(non|non ancora|aspetta|annulla|più tardi|mai)\\b' +
    '|\\b(niet|nog niet|wacht|annuleren|later|nooit)\\b' +
    '|\\b(ikke|vent|annuller|senere|aldrig)\\b' +
    '|\\b(δεν|όχι|μην|περίμενε|ακύρωση|αργότερα|ποτέ)\\b' +
    '|\\b(ei|älä|odota|peruuta|myöhemmin|ei koskaan)\\b' +
    '|(नहीं|मत|रुको|रद्द|बाद में|कभी नहीं)' +
    '|\\b(tidak|jangan|tunggu|batal|nanti|tidak pernah)\\b' +
    '|\\b(ikke|vent|avbryt|senere|aldri)\\b' +
    '|\\b(nie|poczekaj|anuluj|później|nigdy)\\b' +
    '|\\b(inte|vänta|avbryt|senare|aldrig)\\b' +
    '|\\b(yapma|hayır|bekle|iptal|sonra|asla)\\b' +
    '|(не|ні|зачекай|скасувати|пізніше|ніколи)' +
    '|\\b(không|đừng|chưa|chờ|hủy|sau)\\b' +
    '|(しない|やめて|まだ|後で|キャンセル|ないで)' +
    '|(하지마|안|아직|나중에|취소)' +
    '|(ไม่|อย่า|ยัง|รอ|ยกเลิก|ทีหลัง)' +
    '|(不要|别|不|还没|等一下|取消|以后|還沒|等一下)' +
    ')',
  'i'
)

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

export const INSIGHT_KINDS = ['insight', 'recommendation', 'prediction'] as const

export type InsightKind = (typeof INSIGHT_KINDS)[number]

export function parseInsightKind(value: unknown): InsightKind | null {
  for (const k of INSIGHT_KINDS) {
    if (value === k) return k
  }
  return null
}

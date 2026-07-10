import { logger } from '../../logging/index.js'

export const VALID_PROBLEM_TYPES = ['cta_buried', 'contact_hidden', 'no_social_proof'] as const
export type ProblemType = typeof VALID_PROBLEM_TYPES[number]

export interface ParsedPulseResult {
  problemType: ProblemType
  headline: string
  description: string
  suggestedFix: string
  confidence: number
}

export function parsePulseResponse(text: string): ParsedPulseResult | null {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    logger.warn('pulse-analyze.parse.json_error', { textSnippet: cleaned.substring(0, 200) })
    return null
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).problemType !== 'string' ||
    typeof (parsed as Record<string, unknown>).headline !== 'string' ||
    typeof (parsed as Record<string, unknown>).description !== 'string' ||
    typeof (parsed as Record<string, unknown>).suggestedFix !== 'string' ||
    typeof (parsed as Record<string, unknown>).confidence !== 'number'
  ) {
    logger.warn('pulse-analyze.parse.invalid_shape', {})
    return null
  }

  const raw = parsed as {
    problemType: string
    headline: string
    description: string
    suggestedFix: string
    confidence: number
  }

  const problemType: ProblemType = VALID_PROBLEM_TYPES.includes(raw.problemType as ProblemType)
    ? (raw.problemType as ProblemType)
    : 'cta_buried'

  return {
    problemType,
    headline: raw.headline,
    description: raw.description,
    suggestedFix: raw.suggestedFix,
    confidence: Math.max(0, Math.min(1, raw.confidence)),
  }
}

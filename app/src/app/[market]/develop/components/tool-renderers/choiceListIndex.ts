import { logger } from '@/lib/request-context'

export function parseChoiceListIndex(value: string, context: string): number | null {
  const index = Number.parseInt(value, 10)
  if (!Number.isFinite(index)) {
    logger.warn('choice-list.invalid-decision-value', { context, value })
    return null
  }
  return index
}

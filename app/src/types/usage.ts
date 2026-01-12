/**
 * Warning level for daily usage thresholds
 */
export const WarningLevel = {
  NONE: 'none',
  CAUTION: 'caution',
  WARNING: 'warning',
  EXCEEDED: 'exceeded',
} as const

export type WarningLevel = (typeof WarningLevel)[keyof typeof WarningLevel]

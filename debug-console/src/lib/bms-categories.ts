/**
 * BMS attribution categories used by the App Detail panel.
 *
 * Single source of truth lives in @airo/ai-lib's cost-attribution module
 * (packages/ai-lib/src/budget/cost-attribution/types.ts). Re-exported here
 * so the rest of debug-console can import a stable local symbol and so
 * future renames are a one-line change.
 */

import { ReportLabel } from '@airo/ai-lib/budget'

export { ReportLabel }

/** All ReportLabel values, for fan-out over category breakdowns. */
export const ALL_REPORT_LABELS: readonly ReportLabel[] = Object.freeze(
  Object.values(ReportLabel)
) as readonly ReportLabel[]

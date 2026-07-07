export const AUTOMATION_MAX_NAME_LENGTH = 100
export const AUTOMATION_MAX_DESCRIPTION_LENGTH = 300
// Prompts are sent as chat messages; keep well under the agent's 40,000-char hard limit.
export const AUTOMATION_MAX_PROMPT_LENGTH = 10_000

/** Hosted automation record from airo-go — present for both scheduled and manual-only automations. */
export interface AutomationSchedule {
  /** airo-go automation id (= hosting scheduled task id) */
  id: string
  /** 'cron' for scheduled automations, 'manual' for on-demand only */
  triggerType: 'cron' | 'manual'
  /** Only present when triggerType is 'cron' */
  cronExpr?: string
  enabled: boolean
  /** nextRunAt as ISO string from airo-go — only present for cron automations */
  nextRunAt?: string
}

export interface Automation {
  id: string
  name: string
  description: string
  prompt: string
  isDefault?: boolean
  /** Set when this automation has been scheduled via airo-go */
  schedule?: AutomationSchedule
}

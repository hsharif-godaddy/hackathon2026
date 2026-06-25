export const AUTOMATION_MAX_NAME_LENGTH = 100
export const AUTOMATION_MAX_DESCRIPTION_LENGTH = 300
// Prompts are sent as chat messages; keep well under the agent's 40,000-char hard limit.
export const AUTOMATION_MAX_PROMPT_LENGTH = 10_000

export interface Automation {
  id: string
  name: string
  description: string
  prompt: string
  isDefault?: boolean
}

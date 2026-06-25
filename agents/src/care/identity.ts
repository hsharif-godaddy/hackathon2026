import { randomUUID } from 'node:crypto'

/**
 * Generate a UCID — UUID v4 used as the cross-system correlation id
 * for an Airo Care conversation. One UCID per AAB conversation, sticky
 * across all support turns on that conversation.
 */
export function generateUcid(): string {
  return randomUUID()
}

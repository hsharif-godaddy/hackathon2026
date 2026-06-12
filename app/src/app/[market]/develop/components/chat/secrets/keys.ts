/**
 * Secret resolution key format utilities.
 * Keys are used to track which secrets have been resolved/submitted to prevent re-showing.
 *
 * Format:
 * - Single-secret: `${toolCallId}:${secretName}` (e.g. "tc-1:OPENAI_API_KEY")
 * - Multi-secret batch: `${toolCallId}:batch` (e.g. "tc-twilio:batch")
 */

export function batchSecretKey(toolCallId: string): string {
  return `${toolCallId}:batch`
}

export function secretKeyFor(toolCallId: string, secretName: string): string {
  return `${toolCallId}:${secretName}`
}

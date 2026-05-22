/**
 * Redact sensitive fields from skill tool output before sending to clients.
 * Replaces `instructions` and `dependentInstructions` with '[redacted]' when present.
 * Returns the output unchanged for non-skill tools or non-object outputs.
 */
export function redactSkillOutput(toolName: string, output: unknown): unknown {
  // Literal `skill` is the current transport-level wrapper tool; named skills
  // use `{skillName}__{toolName}` and do not expose this wrapper output shape.
  if (toolName !== 'skill' || !output || typeof output !== 'object' || Array.isArray(output)) {
    return output
  }
  const out = output as Record<string, unknown>
  return {
    ...out,
    ...('instructions' in out && { instructions: '[redacted]' }),
    ...('dependentInstructions' in out && { dependentInstructions: '[redacted]' })
  }
}

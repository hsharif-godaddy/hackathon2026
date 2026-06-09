/** Separator used between skill name and tool name in prefixed tool names */
export const SKILL_TOOL_SEPARATOR = '__'

/**
 * Build a prefixed tool name from skill name and tool name.
 *
 * For nested skills (e.g. "payment/stripe"), only the last path segment is used
 * as the prefix so tool names stay valid for all AI providers (OpenAI/Anthropic
 * reject "/" in function names) and match the names referenced in skill.md
 * instructions (e.g. "stripe__setup", not "payment/stripe__setup").
 */
export function buildSkillToolName(skillName: string, toolName: string): string {
  const prefix = skillName.includes('/') ? skillName.split('/').at(-1)! : skillName
  return `${prefix}${SKILL_TOOL_SEPARATOR}${toolName}`
}

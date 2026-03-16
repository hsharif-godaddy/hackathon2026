/** Separator used between skill name and tool name in prefixed tool names */
export const SKILL_TOOL_SEPARATOR = '__'

/** Build a prefixed tool name from skill name and tool name */
export function buildSkillToolName(skillName: string, toolName: string): string {
  return `${skillName}${SKILL_TOOL_SEPARATOR}${toolName}`
}

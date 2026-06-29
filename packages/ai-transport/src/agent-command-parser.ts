export type AgentCommandParseResult =
  | { hasCommand: false; hasBody: false }
  | { hasCommand: true; hasBody: false; agentId: string }
  | { hasCommand: true; hasBody: true; agentId: string; strippedContent: string }

/**
 * Parse a first-line `/agent <id>` override. Agent IDs can include hyphens
 * because registered initial variants use names such as `initial-v3`.
 */
export function parseAgentCommand(content: string): AgentCommandParseResult {
  const firstLine = content.split('\n')[0]?.trim()
  const match = firstLine?.match(/^\/agent\s+([\w-]+)$/i)
  const agentId = match?.[1]
  if (!agentId) return { hasCommand: false, hasBody: false }

  const strippedContent = content.split('\n').slice(1).join('\n').trimStart()
  const hasBody = strippedContent.trim().length > 0
  if (!hasBody) {
    return {
      hasCommand: true,
      hasBody: false,
      agentId: agentId.toLowerCase(),
    }
  }

  return {
    hasCommand: true,
    hasBody: true,
    agentId: agentId.toLowerCase(),
    strippedContent,
  }
}

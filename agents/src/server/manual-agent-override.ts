import { parseAgentCommand } from '@airo/ai-transport'

interface ManualAgentOverrideLogger {
  info: (event: string, data: Record<string, unknown>) => void
}

export function resolveManualAgentOverride(
  socketId: string,
  message: unknown,
  logger: ManualAgentOverrideLogger
): string | undefined {
  if (!message || typeof message !== 'string') return undefined

  const parsedAgentCommand = parseAgentCommand(message)

  if (parsedAgentCommand.hasCommand && parsedAgentCommand.hasBody) {
    const requestedAgent = parsedAgentCommand.agentId
    logger.info('websocket.agent_router.manual_override', {
      socketId,
      requestedAgent,
      message: 'Manual agent override detected in message',
    })
    return requestedAgent
  }

  if (parsedAgentCommand.hasCommand) {
    logger.info('websocket.agent_router.manual_override_bodyless_passthrough', {
      socketId,
      requestedAgent: parsedAgentCommand.agentId,
      message: 'Manual agent override ignored because message body is empty',
    })
  }

  return undefined
}

import type { AgentConfig } from '@airo/ai-lib';
import { log } from '../logging/index.js';

/**
 * Create a structured logger compatible with ai-lib telemetry hooks.
 *
 * @param agentId - Identifier of the agent emitting logs.
 * @returns Agent logger implementation that routes events through the centralized logger.
 */
export function createAgentTelemetryLogger(agentId: string): NonNullable<AgentConfig['logger']> {
  const agentLogger = log.forAgent(agentId);

  return {
    info: (event, data) => agentLogger.info(event, data),
    warn: (event, data) => agentLogger.warn(event, data),
    error: (event, data) => agentLogger.error(event, data),
  };
}

import { SWITCHBOARD_AAB_MCP_ELICITATION } from '@/config/switchboard-flags'
import { logger } from '@/lib/request-context'
import { checkSwitchboardFlag, type SwitchboardRequest } from '@/lib/switchboard/server'

const MCP_ELICITATION_MIN_PROTOCOL_VERSION = '2025-06-18'
const MCP_ELICITATION_MODE_CAPABILITIES_MIN_PROTOCOL_VERSION = '2025-11-25'

export const MCP_ELICITATION_MODE_INITIALIZE_CAPABILITIES = {
  elicitation: {
    form: {},
    url: {},
  },
} as const

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export async function resolveMcpElicitationEnabled(
  request: SwitchboardRequest,
  serverId: string,
): Promise<boolean> {
  try {
    return await checkSwitchboardFlag(SWITCHBOARD_AAB_MCP_ELICITATION, request)
  } catch (err) {
    logger.warn('mcp.elicitation.flag.lookup_failed', {
      serverId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export function serverSupportsElicitation(server: { protocolVersion: string }): boolean {
  return server.protocolVersion >= MCP_ELICITATION_MIN_PROTOCOL_VERSION
}

export function buildMcpInitializeCapabilities(
  baseCapabilities: Record<string, unknown>,
  elicitationEnabled: boolean,
  protocolVersion: string,
): Record<string, unknown> {
  if (!elicitationEnabled || protocolVersion < MCP_ELICITATION_MIN_PROTOCOL_VERSION) {
    return baseCapabilities
  }

  const baseElicitation = recordOrUndefined(baseCapabilities.elicitation)
  const modeCapabilities =
    protocolVersion >= MCP_ELICITATION_MODE_CAPABILITIES_MIN_PROTOCOL_VERSION
      ? MCP_ELICITATION_MODE_INITIALIZE_CAPABILITIES.elicitation
      : {}

  return {
    ...baseCapabilities,
    elicitation: {
      ...baseElicitation,
      ...modeCapabilities,
    },
  }
}

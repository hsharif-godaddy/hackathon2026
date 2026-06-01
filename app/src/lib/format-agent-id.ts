export const AGENT_ID_PREFIX = 'airo-app-builder-';

export function formatAgentId(agentName: string): string {
  return `${AGENT_ID_PREFIX}${agentName}`;
}

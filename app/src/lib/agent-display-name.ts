import { AGENT_ID_PREFIX } from '@/lib/format-agent-id';

export interface AgentCatalogEntry {
  id: string;
  name?: string;
}

export function parseAgentKeyFromTargetId(targetId: string): string | null {
  if (!targetId) return null;
  if (targetId.startsWith(AGENT_ID_PREFIX)) {
    const key = targetId.slice(AGENT_ID_PREFIX.length);
    return key || null;
  }
  return targetId;
}

function humanizeAgentKey(agentKey: string): string {
  return agentKey
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Label for UI (banner prompt). Prefers catalog name, then step_start display name, then humanized key.
 */
export function resolveAgentDisplayName(
  agentKey: string | null | undefined,
  catalog: AgentCatalogEntry[],
  stepStartDisplayName?: string | null
): string {
  if (agentKey) {
    const catalogName = catalog.find((entry) => entry.id === agentKey)?.name?.trim();
    if (catalogName) return catalogName;
  }

  const display = stepStartDisplayName?.trim();
  if (display) return display;

  if (agentKey) return humanizeAgentKey(agentKey);

  return 'Agent';
}

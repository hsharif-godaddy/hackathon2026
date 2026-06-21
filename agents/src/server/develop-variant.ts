import { getActiveProfile } from '../profiles/index.js'
import type { ProfileData } from '../profiles/index.js'

/**
 * True when a profile carries develop-phase behavior — any `develop.*` or
 * `skill.*` property.
 */
export function profileHasDevelopFlags(profile: ProfileData | null | undefined): boolean {
  if (!profile) return false
  return Object.keys(profile.properties).some(k => k.startsWith('develop.') || k.startsWith('skill.'))
}

/**
 * Per-profile develop variants were flattened (#4346) — the single `develop`
 * agent handles all profiles via per-turn resolvers. This function is now a
 * pass-through; it remains exported so existing call sites compile without
 * churn but no longer maps to `develop-<profile>`.
 */
export function concreteDevelopForProfile(agentId: string, _profile: ProfileData | null | undefined): string {
  return agentId
}

interface AgentIdStore {
  updateAgentId(conversationId: string, agentId: string): Promise<void>
}

/**
 * The handoff write seam used by the SSE `onAgentChanged` callback (`app.ts`).
 * Maps the handoff target to the active profile's concrete develop variant,
 * then persists it as the conversation's frozen agent. Mapping and persistence
 * are deliberately atomic here: a call site cannot persist an unmapped id, so
 * the `develop-<profile>` mapping can't silently regress without also dropping
 * the persist. Reads the
 * active profile from the ALS context the handoff runs inside (runWithProfile).
 * Returns the concrete id actually stored (for the caller's logging).
 */
export async function persistHandoffAgent(
  store: AgentIdStore,
  conversationId: string,
  newAgent: string,
): Promise<string> {
  const concreteAgent = concreteDevelopForProfile(newAgent, getActiveProfile())
  await store.updateAgentId(conversationId, concreteAgent)
  return concreteAgent
}

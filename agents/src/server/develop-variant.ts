import { getActiveProfile } from '../profiles/index.js'
import type { ProfileData } from '../profiles/index.js'

/**
 * True when a profile carries develop-phase behavior — any `develop.*` or
 * `skill.*` property. The agent factory builds a dedicated `develop-<name>`
 * agent for exactly these profiles (see `ai-lib-agents/index.ts`), so this is
 * also the invariant that guarantees `develop-<name>` is a registered agent.
 */
export function profileHasDevelopFlags(profile: ProfileData | null | undefined): boolean {
  if (!profile) return false
  return Object.keys(profile.properties).some(k => k.startsWith('develop.') || k.startsWith('skill.'))
}

/**
 * Map the base `develop` agent to its profile-specific variant `develop-<name>`
 * when the profile carries develop/skill flags. Any other agent id (a concrete
 * `develop-<name>`, an `initial*` agent, `marketing`, …) passes through unchanged.
 *
 * Why this exists: profiles that have develop/skill flags but NO initial variant
 * (e.g. `experimental`) start on base `initial`, which hands off to base
 * `develop` — so the factory never wires an `initial→develop-<profile>` handoff
 * for them. This mapping is therefore the authoritative way the base `develop`
 * agent becomes the profile variant. Applied (a) at read time in the router so a
 * stored/handed-off `develop` resolves to the variant for the active JWT profile,
 * and (b) at the handoff write seam so the stored id is concrete for metrics.
 */
export function concreteDevelopForProfile(agentId: string, profile: ProfileData | null | undefined): string {
  if (agentId === 'develop' && profileHasDevelopFlags(profile)) {
    return `develop-${profile!.name}`
  }
  return agentId
}

interface AgentIdStore {
  updateAgentId(conversationId: string, agentId: string): Promise<void>
}

/**
 * The handoff write seam shared by both transports' `onAgentChanged` callbacks
 * (WS `ai-lib-websocket-server.ts`, SSE `app.ts`). Maps the handoff target to the
 * active profile's concrete develop variant, then persists it as the
 * conversation's frozen agent. Mapping and persistence are deliberately atomic
 * here: a call site cannot persist an unmapped id, so the `develop-<profile>`
 * mapping can't silently regress without also dropping the persist. Reads the
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

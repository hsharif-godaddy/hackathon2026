import type { ConversationLifecycleStore } from '../memory/interfaces/conversation-store.js'
import { workspaceScopeFromAppId } from '../memory/interfaces/scope.js'

/**
 * Durable fallback for the agent router: the persisted `conversations.agentId`
 * of the app's latest (assumed: single active) conversation, or undefined for a
 * brand-new app with no conversation yet.
 *
 * Shared by both transports (WS + SSE) so a browser reload mid-`initial` — which
 * drops the ephemeral, socket-keyed session — doesn't get wrongly promoted to
 * `develop` by the `hasMessagesForApp` heuristic.
 */
export async function getPersistedAgentIdForApp(
  lifecycleStore: ConversationLifecycleStore,
  appId: string,
): Promise<string | undefined> {
  return (await lifecycleStore.getLatestForApp(workspaceScopeFromAppId(appId)))?.agentId
}

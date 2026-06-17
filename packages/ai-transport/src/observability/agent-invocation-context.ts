import type { Span } from '@opentelemetry/api'

// conversationId → root AGENT invocation span + accumulated skill names for that turn.
//
// The entry is registered when createAgentInvocation() opens the turn and
// unregistered when safeEnd() closes it. skill-loader.ts calls addSkillNameToSpan
// after onLoad (load action) and after onInstall (install action) to stamp skill.names on the span.
type InvocationEntry = { span: Span; skillNames: Set<string> }
const registry = new Map<string, InvocationEntry>()

export function registerInvocationSpan(conversationId: string, span: Span): void {
  registry.set(conversationId, { span, skillNames: new Set() })
}

/** Identity-guarded delete: only removes the entry if the Map still holds the
 * exact span reference passed in. Prevents turn A's safeEnd from deleting turn
 * B's entry when turns overlap (e.g. budget-retry opens a new invocation before
 * the previous safeEnd runs). */
export function unregisterInvocationSpan(conversationId: string, span: Span): void {
  const entry = registry.get(conversationId)
  if (entry?.span === span) {
    registry.delete(conversationId)
  }
}

export function getInvocationSpanByConversation(conversationId: string): Span | undefined {
  return registry.get(conversationId)?.span
}

/** Accumulates skill names on the AGENT span as a comma-separated attribute.
 * Calling this multiple times in one turn builds up the full list:
 *   addSkillNameToSpan(id, 'online-appointments') → skill.names = "online-appointments"
 *   addSkillNameToSpan(id, 'database')            → skill.names = "online-appointments,database"
 *
 * Set semantics: duplicate skill names within a turn are silently ignored.
 * Returns true if the entry was found and the attribute was written, false if
 * the conversationId has no registered span (caller should warn). */
export function addSkillNameToSpan(conversationId: string, skillName: string): boolean {
  const entry = registry.get(conversationId)
  if (!entry) return false
  entry.skillNames.add(skillName)
  entry.span.setAttribute('skill.names', [...entry.skillNames].join(','))
  return true
}

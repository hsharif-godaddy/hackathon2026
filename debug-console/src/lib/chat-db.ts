/**
 * chat-db.ts — in-memory chat session store (no persistence).
 * Sessions are cleared on server restart; acceptable for an internal tool.
 */

export interface ChatSession {
  session_id: string;
  user_email: string;
  context: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

const sessions = new Map<string, ChatSession>();
const messages = new Map<string, ChatMessage[]>();
let msgIdSeq = 1;

function now(): string {
  return new Date().toISOString();
}

export function getOrCreateSession(userEmail: string, context: string): ChatSession {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (const s of sessions.values()) {
    if (s.user_email === userEmail && s.context === context && s.updated_at >= cutoff) {
      return s;
    }
  }
  const sessionId = `${context}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const session: ChatSession = {
    session_id: sessionId,
    user_email: userEmail,
    context,
    created_at: now(),
    updated_at: now(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function saveChatMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): void {
  const msg: ChatMessage = { id: msgIdSeq++, session_id: sessionId, role, content, created_at: now() };
  const list = messages.get(sessionId) ?? [];
  list.push(msg);
  messages.set(sessionId, list);
  const s = sessions.get(sessionId);
  if (s) s.updated_at = now();
}

export function getChatMessages(sessionId: string): ChatMessage[] {
  return [...(messages.get(sessionId) ?? [])];
}

export function getUserSessions(userEmail: string, context?: string, limit = 10): ChatSession[] {
  const all = [...sessions.values()].filter(
    (s) => s.user_email === userEmail && (!context || s.context === context)
  );
  all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return all.slice(0, limit);
}

export function clearOldSessions(daysOld = 30): number {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  let removed = 0;
  for (const [id, s] of sessions.entries()) {
    if (s.updated_at < cutoff) {
      sessions.delete(id);
      messages.delete(id);
      removed++;
    }
  }
  return removed;
}

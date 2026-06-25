import { generateUcid } from './identity.js'

export interface CareSession {
  ucid: string
  careConversationId?: string
}

/**
 * In-memory map from AAB conversationId to Care session state.
 * Session is sticky for the lifetime of an AAB conversation: the same
 * ucid (and, once set, the same careConversationId) are reused on every
 * subsequent support turn until invalidated.
 *
 * Bounded by a TTL sweep — entries idle longer than the configured window
 * are dropped, freeing the Care conversation in Care's ASM via its own
 * idle-timeout workflow.
 */
export class CareSessionStore {
  private sessions = new Map<string, CareSession>()
  private lastTouched = new Map<string, number>()
  private readonly nowFn: () => number

  constructor(now: () => number = () => Date.now()) {
    this.nowFn = now
  }

  getOrInit(aabConversationId: string): CareSession {
    let session = this.sessions.get(aabConversationId)
    if (!session) {
      session = { ucid: generateUcid() }
      this.sessions.set(aabConversationId, session)
    }
    this.lastTouched.set(aabConversationId, this.nowFn())
    return session
  }

  setCareConversationId(aabConversationId: string, careConversationId: string): void {
    const session = this.sessions.get(aabConversationId)
    if (!session) return
    session.careConversationId = careConversationId
    this.lastTouched.set(aabConversationId, this.nowFn())
  }

  invalidate(aabConversationId: string): void {
    this.sessions.delete(aabConversationId)
    this.lastTouched.delete(aabConversationId)
  }

  size(): number {
    return this.sessions.size
  }

  /**
   * Remove sessions whose lastTouched is older than maxAgeMs.
   * `now` override exists for deterministic tests.
   */
  sweep(maxAgeMs: number, now: () => number = this.nowFn): number {
    const currentTime = now()
    let removed = 0
    for (const [convId, touched] of this.lastTouched) {
      if (currentTime - touched > maxAgeMs) {
        this.sessions.delete(convId)
        this.lastTouched.delete(convId)
        removed++
      }
    }
    return removed
  }
}

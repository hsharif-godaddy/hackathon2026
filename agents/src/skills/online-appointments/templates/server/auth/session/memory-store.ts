// ---------------------------------------------------------------------------
// In-memory SessionStore
//
// Suitable for single-instance deployments. Replace with a Redis or DB-backed
// implementation by implementing the SessionStore interface and passing it to
// the session layer's init function.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/require-await */
import { randomBytes } from "node:crypto";
import type { Session, SessionStore } from "./types";
import type { AuthUser } from "../providers/types";

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();

  async create(user: AuthUser, ttlMs = DEFAULT_TTL_MS): Promise<string> {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    this.sessions.set(token, { token, user, createdAt: now, expiresAt: now + ttlMs });
    return token;
  }

  async get(token: string): Promise<Session | null> {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  async destroy(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async touch(token: string, ttlMs = DEFAULT_TTL_MS): Promise<void> {
    const session = this.sessions.get(token);
    if (session) {
      session.expiresAt = Date.now() + ttlMs;
    }
  }
}

export const sessionStore: SessionStore = new MemorySessionStore();

import type { AuthUser } from "../providers/types";

export interface Session {
  token: string;
  user: AuthUser;
  createdAt: number;
  expiresAt: number;
}

/** Pluggable session backend. Swap for a Redis/DB-backed store in production. */
export interface SessionStore {
  create(user: AuthUser, ttlMs?: number): Promise<string>;
  get(token: string): Promise<Session | null>;
  destroy(token: string): Promise<void>;
  /** Extend the session TTL on activity. */
  touch(token: string, ttlMs?: number): Promise<void>;
}

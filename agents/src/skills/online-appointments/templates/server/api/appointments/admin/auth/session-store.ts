import { randomBytes } from "node:crypto";

interface Session {
  token: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const sessions = new Map<string, Session>();

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { token, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

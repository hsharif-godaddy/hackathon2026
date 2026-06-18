/**
 * Chat persistence layer
 * Stores chat sessions and messages per user
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';

import { scheduleUpload } from './db-backup';

const DB_PATH = join(process.cwd(), 'data', 'feedback_analytics.db');

let db: Database.Database | null = null;

export function getChatDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initChatSchema(db);
  }
  return db;
}

function initChatSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      context TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_email ON chat_sessions(user_email);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
  `);
}

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

/**
 * Get or create active session for user + context
 */
export function getOrCreateSession(
  userEmail: string,
  context: string
): ChatSession {
  const db = getChatDb();

  // Check for existing session (within last 24 hours)
  const existing = db
    .prepare<[string, string]>(
      `SELECT * FROM chat_sessions
       WHERE user_email = ? AND context = ?
       AND updated_at >= datetime('now', '-1 day')
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(userEmail, context) as ChatSession | undefined;

  if (existing) {
    return existing;
  }

  // Create new session
  const sessionId = `${context}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  db.prepare(
    `INSERT INTO chat_sessions (session_id, user_email, context) VALUES (?, ?, ?)`
  ).run(sessionId, userEmail, context);

  // Schedule S3 backup after new session created
  scheduleUpload(DB_PATH, 'feedback_analytics.db');

  return db
    .prepare<[string]>(`SELECT * FROM chat_sessions WHERE session_id = ?`)
    .get(sessionId) as ChatSession;
}

/**
 * Save a chat message
 */
export function saveChatMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): void {
  const db = getChatDb();

  db.prepare(
    `INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)`
  ).run(sessionId, role, content);

  // Update session timestamp
  db.prepare(
    `UPDATE chat_sessions SET updated_at = datetime('now') WHERE session_id = ?`
  ).run(sessionId);

  // Schedule S3 backup after chat message saved
  scheduleUpload(DB_PATH, 'feedback_analytics.db');
}

/**
 * Get all messages for a session
 */
export function getChatMessages(sessionId: string): ChatMessage[] {
  const db = getChatDb();

  return db
    .prepare<[string]>(
      `SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`
    )
    .all(sessionId) as ChatMessage[];
}

/**
 * Get recent sessions for a user
 */
export function getUserSessions(
  userEmail: string,
  context?: string,
  limit = 10
): ChatSession[] {
  const db = getChatDb();

  if (context) {
    return db
      .prepare<[string, string, number]>(
        `SELECT * FROM chat_sessions
         WHERE user_email = ? AND context = ?
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(userEmail, context, limit) as ChatSession[];
  }

  return db
    .prepare<[string, number]>(
      `SELECT * FROM chat_sessions
       WHERE user_email = ?
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(userEmail, limit) as ChatSession[];
}

/**
 * Clear old sessions (cleanup job)
 */
export function clearOldSessions(daysOld = 30): number {
  const db = getChatDb();

  const result = db
    .prepare(
      `DELETE FROM chat_sessions WHERE updated_at < datetime('now', '-${daysOld} days')`
    )
    .run();

  // Schedule S3 backup after cleanup
  if (result.changes > 0) {
    scheduleUpload(DB_PATH, 'feedback_analytics.db');
  }

  return result.changes;
}

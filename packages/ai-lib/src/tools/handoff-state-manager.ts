/**
 * Session state manager
 *
 * Manages session state including:
 * - Current agent handling the session (handoff support)
 * - Selected todo list for the session
 * - Session history and activity tracking
 *
 * This is useful for:
 * - Agent handoff functionality
 * - Todo list context management
 * - Simple single-process applications
 * - Development and debugging
 *
 * For production multi-process/distributed systems, implement a custom
 * state manager backed by Redis, database, or other shared storage.
 */

import { createLogger } from '@airo/ai-common'
import type { HandoffStateManager } from './handoff-helpers.js'

const logger = createLogger('handoff-state-manager')

/**
 * Suggested color palette data
 */
export interface SuggestedPalette {
  name: string
  primary: string
  secondary?: string
  accent?: string
  background?: string
  foreground?: string
  muted?: string
  border?: string
  destructive?: string
  success?: string
  warning?: string
}

/**
 * Font info for a single font (header or body)
 */
export interface SuggestedFontInfo {
  name: string
  weights: string[]
  category: string
}

/**
 * Suggested font data - supports both legacy single-font and new header/body pairings
 */
export interface SuggestedFont {
  name: string
  /** @deprecated Use headerFont/bodyFont instead */
  fontName?: string
  /** @deprecated Use headerFont/bodyFont instead */
  weights?: string[]
  /** @deprecated Use headerFont/bodyFont instead */
  category?: string
  headerFont?: SuggestedFontInfo
  bodyFont?: SuggestedFontInfo
}

/**
 * Session state tracking
 */
interface SessionState {
  /** Current agent ID handling this session */
  currentAgentId: string
  /** Currently selected todo list ID for this session */
  selectedTodoListId?: string
  /** Suggested color palettes for this session (keyed by palette name) */
  suggestedPalettes?: Map<string, SuggestedPalette>
  /** Suggested fonts for this session (keyed by font theme name) */
  suggestedFonts?: Map<string, SuggestedFont>
  /** History of agent switches */
  history: Array<{
    fromAgentId: string
    toAgentId: string
    reason?: string
    timestamp: Date
  }>
  /** When this session was created */
  createdAt: Date
  /** Last activity timestamp */
  lastActivityAt: Date
  /** Prompt from the last handoff (to be sent to new agent) */
  lastHandoffPrompt?: string
  /** App ID this session is associated with (for clearing sessions when app changes) */
  appId?: string
}

/**
 * Configuration for session state manager
 */
export interface SessionStateManagerConfig {
  /** Default agent ID for new sessions */
  defaultAgentId?: string
  /** Session timeout in milliseconds (default: 1 hour) */
  sessionTimeout?: number
  /** Whether to log state events (default: true) */
  enableLogging?: boolean
  /** Callback when agent switches */
  onAgentSwitch?: (sessionId: string, fromAgentId: string, toAgentId: string, reason?: string) => void
  /** Callback when todo list is selected */
  onTodoListSelect?: (sessionId: string, todoListId: string) => void
}

/**
 * In-memory implementation of session state manager
 *
 * Tracks agent handoffs and selected todo lists for each session.
 *
 * @example
 * ```typescript
 * const stateManager = createSessionStateManager({
 *   defaultAgentId: 'coordinator',
 *   sessionTimeout: 30 * 60 * 1000, // 30 minutes
 *   onAgentSwitch: (sessionId, from, to, reason) => {
 *     console.log(`Session ${sessionId}: ${from} → ${to}`)
 *   },
 *   onTodoListSelect: (sessionId, todoListId) => {
 *     console.log(`Session ${sessionId} selected todo list: ${todoListId}`)
 *   }
 * })
 *
 * // Use with handoff tool
 * const handoffTool = createHandoffTool({
 *   agents,
 *   sourceAgentId: 'coordinator',
 *   stateManager,
 *   sessionId: 'user-session-123'
 * })
 * ```
 */
export class SessionStateManager implements HandoffStateManager {
  private sessions = new Map<string, SessionState>()
  private config: Required<SessionStateManagerConfig>
  private cleanupInterval?: NodeJS.Timeout

  constructor(config: SessionStateManagerConfig = {}) {
    this.config = {
      defaultAgentId: config.defaultAgentId || 'default',
      sessionTimeout: config.sessionTimeout || 60 * 60 * 1000, // 1 hour
      enableLogging: config.enableLogging ?? true,
      onAgentSwitch: config.onAgentSwitch || (() => {}),
      onTodoListSelect: config.onTodoListSelect || (() => {})
    }

    // Start cleanup interval to remove expired sessions
    this.startCleanup()
  }

  /**
   * Switch the active agent for a session
   *
   * @param sessionId - Session identifier
   * @param targetAgentId - Agent to switch to
   * @param reason - Optional reason for the switch
   * @returns true if switch was successful
   */
  async switchAgent(
    sessionId: string,
    targetAgentId: string,
    prompt?: string
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    const fromAgentId = session?.currentAgentId || this.config.defaultAgentId

    if (this.config.enableLogging) {
      logger.info(`Handoff: ${fromAgentId} -> ${targetAgentId} (session: ${sessionId})`)
      if (prompt) {
        logger.info(`   Prompt: ${prompt}`)
      }
    }

    // Create or update session
    if (session) {
      session.currentAgentId = targetAgentId
      session.lastActivityAt = new Date()
      if (prompt) {
        session.lastHandoffPrompt = prompt // Store prompt for WebSocket server to use
      }
      session.history.push({
        fromAgentId,
        toAgentId: targetAgentId,
        ...(prompt && { prompt }),
        timestamp: new Date()
      })
    } else {
      const newSession: SessionState = {
        currentAgentId: targetAgentId,
        history: [{
          fromAgentId,
          toAgentId: targetAgentId,
          ...(prompt && { prompt }),
          timestamp: new Date()
        }],
        createdAt: new Date(),
        lastActivityAt: new Date()
      }
      if (prompt) {
        newSession.lastHandoffPrompt = prompt // Store prompt for WebSocket server to use
      }
      this.sessions.set(sessionId, newSession)
    }

    // Call callback
    this.config.onAgentSwitch(sessionId, fromAgentId, targetAgentId, prompt)

    return true
  }

  /**
   * Get the current agent for a session
   *
   * @param sessionId - Session identifier
   * @returns Current agent ID or undefined if session doesn't exist
   */
  getCurrentAgent(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId)
    return session?.currentAgentId
  }

  /**
   * Get the prompt from the last handoff
   *
   * @param sessionId - Session identifier
   * @returns Prompt from last handoff or undefined
   */
  getLastHandoffPrompt(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId)
    return session?.lastHandoffPrompt
  }

  /**
   * Clear the last handoff prompt after it's been used
   *
   * @param sessionId - Session identifier
   */
  clearLastHandoffPrompt(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      delete session.lastHandoffPrompt
    }
  }

  /**
   * Set the selected todo list for a session
   *
   * @param sessionId - Session identifier
   * @param todoListId - Todo list ID to select
   */
  setSelectedTodoList(sessionId: string, todoListId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.selectedTodoListId = todoListId
      session.lastActivityAt = new Date()

      if (this.config.enableLogging) {
        logger.info(`Session ${sessionId} selected todo list: ${todoListId}`)
      }

      this.config.onTodoListSelect(sessionId, todoListId)
    } else {
      // Create session if it doesn't exist
      this.getOrCreateSession(sessionId)
      const newSession = this.sessions.get(sessionId)
      if (newSession) {
        newSession.selectedTodoListId = todoListId

        if (this.config.enableLogging) {
          logger.info(`Created session ${sessionId} with todo list: ${todoListId}`)
        }

        this.config.onTodoListSelect(sessionId, todoListId)
      }
    }
  }

  /**
   * Get the selected todo list for a session
   *
   * @param sessionId - Session identifier
   * @returns Selected todo list ID or undefined
   */
  getSelectedTodoList(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId)
    return session?.selectedTodoListId
  }

  /**
   * Clear the selected todo list for a session
   *
   * @param sessionId - Session identifier
   */
  clearSelectedTodoList(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      delete session.selectedTodoListId

      if (this.config.enableLogging) {
        logger.info(`Cleared selected todo list for session: ${sessionId}`)
      }
    }
  }

  /**
   * Get or create a session with default agent
   *
   * @param sessionId - Session identifier
   * @param agentId - Initial agent ID (defaults to config.defaultAgentId)
   * @returns Current agent ID for the session
   */
  getOrCreateSession(sessionId: string, agentId?: string): string {
    let session = this.sessions.get(sessionId)

    if (!session) {
      const initialAgentId = agentId || this.config.defaultAgentId
      session = {
        currentAgentId: initialAgentId,
        history: [],
        createdAt: new Date(),
        lastActivityAt: new Date()
      }
      this.sessions.set(sessionId, session)

      if (this.config.enableLogging) {
        logger.info(`Created new session ${sessionId} with agent: ${initialAgentId}`)
      }
    } else {
      // Update last activity
      session.lastActivityAt = new Date()
    }

    return session.currentAgentId
  }

  /**
   * Get handoff history for a session
   *
   * @param sessionId - Session identifier
   * @returns Array of handoff history entries
   */
  getSessionHistory(sessionId: string): SessionState['history'] {
    return this.sessions.get(sessionId)?.history || []
  }

  /**
   * Get all active sessions
   *
   * @returns Array of session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  /**
   * Get session count
   *
   * @returns Number of active sessions
   */
  getSessionCount(): number {
    return this.sessions.size
  }

  /**
   * Get session metadata (e.g., appId)
   *
   * @param sessionId - Session identifier
   * @returns Metadata object with appId if available
   */
  getSessionMetadata(sessionId: string): { appId?: string } | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined

    // Only include appId if it's defined
    if (session.appId) {
      return { appId: session.appId }
    }
    return {}
  }

  /**
   * Set session metadata (e.g., appId)
   *
   * @param sessionId - Session identifier
   * @param metadata - Metadata to set
   */
  setSessionMetadata(sessionId: string, metadata: { appId?: string }): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      if (metadata.appId) {
        session.appId = metadata.appId
      }
      session.lastActivityAt = new Date()
    }
  }

  /**
   * Clear a specific session
   *
   * @param sessionId - Session identifier
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId)

    if (this.config.enableLogging) {
      logger.info(`Cleared session: ${sessionId}`)
    }
  }

  /**
   * Clear all sessions
   */
  clearAllSessions(): void {
    const count = this.sessions.size
    this.sessions.clear()

    if (this.config.enableLogging) {
      logger.info(`Cleared ${count} sessions`)
    }
  }

  /**
   * Remove expired sessions based on sessionTimeout
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now()
    const expiredSessions: string[] = []

    for (const [sessionId, session] of this.sessions.entries()) {
      const age = now - session.lastActivityAt.getTime()
      if (age > this.config.sessionTimeout) {
        expiredSessions.push(sessionId)
      }
    }

    if (expiredSessions.length > 0) {
      for (const sessionId of expiredSessions) {
        this.sessions.delete(sessionId)
      }

      if (this.config.enableLogging) {
        logger.info(`Cleaned up ${expiredSessions.length} expired sessions`)
      }
    }
  }

  /**
   * Start automatic cleanup of expired sessions
   */
  private startCleanup(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions()
    }, 5 * 60 * 1000)

    // Don't prevent process from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref()
    }
  }

  /**
   * Get or create a session state object (internal helper)
   *
   * @param sessionId - Session identifier
   * @returns SessionState object
   */
  private getOrCreateSessionState(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId)

    if (!session) {
      session = {
        currentAgentId: this.config.defaultAgentId,
        history: [],
        createdAt: new Date(),
        lastActivityAt: new Date()
      }
      this.sessions.set(sessionId, session)

      if (this.config.enableLogging) {
        logger.info(`Created new session ${sessionId} with agent: ${this.config.defaultAgentId}`)
      }
    } else {
      // Update last activity
      session.lastActivityAt = new Date()
    }

    return session
  }

  /**
   * Store suggested color palettes for a session
   *
   * @param sessionId - Session identifier
   * @param palettes - Array of palette suggestions to store
   */
  storeSuggestedPalettes(sessionId: string, palettes: SuggestedPalette[]): void {
    const session = this.getOrCreateSessionState(sessionId)

    if (!session.suggestedPalettes) {
      session.suggestedPalettes = new Map()
    }

    palettes.forEach(function storePalette(palette) {
      session.suggestedPalettes!.set(palette.name, palette)
    })

    session.lastActivityAt = new Date()

    if (this.config.enableLogging) {
      logger.info(`[SessionState] Stored ${palettes.length} palette(s) for session ${sessionId}`)
    }
  }

  /**
   * Get a suggested palette by name for a session
   *
   * @param sessionId - Session identifier
   * @param paletteName - Name of the palette to retrieve
   * @returns Palette data if found, undefined otherwise
   */
  getSuggestedPalette(sessionId: string, paletteName: string): SuggestedPalette | undefined {
    const session = this.sessions.get(sessionId)
    if (!session?.suggestedPalettes) {
      return undefined
    }

    return session.suggestedPalettes.get(paletteName)
  }

  /**
   * Get all suggested palettes for a session
   *
   * @param sessionId - Session identifier
   * @returns Array of all suggested palettes
   */
  getAllSuggestedPalettes(sessionId: string): SuggestedPalette[] {
    const session = this.sessions.get(sessionId)
    if (!session?.suggestedPalettes) {
      return []
    }

    return Array.from(session.suggestedPalettes.values())
  }

  /**
   * Clear suggested palettes for a session
   *
   * @param sessionId - Session identifier
   */
  clearSuggestedPalettes(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.suggestedPalettes = new Map()
      session.lastActivityAt = new Date()

      if (this.config.enableLogging) {
        logger.info(`[SessionState] Cleared palettes for session ${sessionId}`)
      }
    }
  }

  /**
   * Store suggested fonts for a session
   *
   * @param sessionId - Session identifier
   * @param fonts - Array of font suggestions to store
   */
  storeSuggestedFonts(sessionId: string, fonts: SuggestedFont[]): void {
    const session = this.getOrCreateSessionState(sessionId)

    if (!session.suggestedFonts) {
      session.suggestedFonts = new Map()
    }

    fonts.forEach(function storeFont(font) {
      session.suggestedFonts!.set(font.name, font)
    })

    session.lastActivityAt = new Date()

    if (this.config.enableLogging) {
      logger.info(`[SessionState] Stored ${fonts.length} font(s) for session ${sessionId}`)
    }
  }

  /**
   * Get a suggested font by name for a session
   *
   * @param sessionId - Session identifier
   * @param fontName - Name of the font theme to retrieve
   * @returns Font data if found, undefined otherwise
   */
  getSuggestedFont(sessionId: string, fontName: string): SuggestedFont | undefined {
    const session = this.sessions.get(sessionId)
    if (!session?.suggestedFonts) {
      return undefined
    }

    return session.suggestedFonts.get(fontName)
  }

  /**
   * Get all suggested fonts for a session
   *
   * @param sessionId - Session identifier
   * @returns Array of all suggested fonts
   */
  getAllSuggestedFonts(sessionId: string): SuggestedFont[] {
    const session = this.sessions.get(sessionId)
    if (!session?.suggestedFonts) {
      return []
    }

    return Array.from(session.suggestedFonts.values())
  }

  /**
   * Clear suggested fonts for a session
   *
   * @param sessionId - Session identifier
   */
  clearSuggestedFonts(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.suggestedFonts = new Map()
      session.lastActivityAt = new Date()

      if (this.config.enableLogging) {
        logger.info(`[SessionState] Cleared fonts for session ${sessionId}`)
      }
    }
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      delete this.cleanupInterval
    }
  }

  /**
   * Get statistics about the state manager
   */
  getStats(): {
    totalSessions: number
    oldestSession: Date | null
    newestSession: Date | null
    totalHandoffs: number
  } {
    let oldestSession: Date | null = null
    let newestSession: Date | null = null
    let totalHandoffs = 0

    for (const session of this.sessions.values()) {
      if (!oldestSession || session.createdAt < oldestSession) {
        oldestSession = session.createdAt
      }
      if (!newestSession || session.createdAt > newestSession) {
        newestSession = session.createdAt
      }
      totalHandoffs += session.history.length
    }

    return {
      totalSessions: this.sessions.size,
      oldestSession,
      newestSession,
      totalHandoffs
    }
  }
}

/**
 * Create a session state manager
 *
 * @param config - Configuration options
 * @returns SessionStateManager instance
 *
 * @example
 * ```typescript
 * const stateManager = createSessionStateManager({
 *   defaultAgentId: 'coordinator',
 *   sessionTimeout: 30 * 60 * 1000,
 *   onAgentSwitch: (sessionId, from, to) => {
 *     console.log(`Switched: ${from} → ${to}`)
 *   },
 *   onTodoListSelect: (sessionId, todoListId) => {
 *     console.log(`Selected todo list: ${todoListId}`)
 *   }
 * })
 * ```
 */
export function createSessionStateManager(
  config?: SessionStateManagerConfig
): SessionStateManager {
  return new SessionStateManager(config)
}

/**
 * @deprecated Use createSessionStateManager instead
 */
export function createInMemoryHandoffStateManager(
  config?: SessionStateManagerConfig
): SessionStateManager {
  return new SessionStateManager(config)
}

/**
 * @deprecated Use SessionStateManager instead
 */
export type InMemoryHandoffStateManager = SessionStateManager

/**
 * @deprecated Use SessionStateManagerConfig instead
 */
export type InMemoryHandoffStateManagerConfig = SessionStateManagerConfig


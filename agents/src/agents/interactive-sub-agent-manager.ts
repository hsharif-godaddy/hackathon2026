import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'interactive-sub-agent-manager' })

export interface InteractiveSession {
  parentAgentName: string
  childAgentName: string
  socketId: string
  task: string
}

export interface InteractiveSubAgentManagerDeps {
  switchAgent: (sessionId: string, targetAgentId: string, prompt?: string) => Promise<boolean>
  registerAgent: (agentId: string, config: unknown) => void
  removeAgent: (agentId: string) => void
}

export class InteractiveSubAgentManager {
  private readonly sessions = new Map<string, InteractiveSession>()
  private deps: InteractiveSubAgentManagerDeps | undefined

  setDeps(deps: InteractiveSubAgentManagerDeps): void {
    this.deps = deps
  }

  getDeps(): InteractiveSubAgentManagerDeps {
    if (!this.deps) {
      throw new Error('InteractiveSubAgentManager deps not initialized')
    }
    return this.deps
  }

  launch(
    socketId: string,
    parentAgentName: string,
    childAgentName: string,
    task: string,
  ): void {
    if (this.sessions.has(socketId)) {
      throw new Error('An interactive sub-agent is already running on this connection')
    }

    const session: InteractiveSession = {
      parentAgentName,
      childAgentName,
      socketId,
      task,
    }

    this.sessions.set(socketId, session)

    logger.info('interactive.session.created', {
      socketId,
      parentAgent: parentAgentName,
      childAgent: childAgentName,
    })
  }

  async triggerHandoffToChild(socketId: string, task: string): Promise<void> {
    if (!this.deps) {
      throw new Error('InteractiveSubAgentManager deps not initialized')
    }
    const session = this.sessions.get(socketId)
    if (!session) {
      throw new Error('No interactive session for this socket')
    }

    await this.deps.switchAgent(socketId, session.childAgentName, task)
  }

  async handleReturn(socketId: string, summary: string): Promise<void> {
    if (!this.deps) {
      throw new Error('InteractiveSubAgentManager deps not initialized')
    }
    const session = this.sessions.get(socketId)
    if (!session) {
      throw new Error('No interactive session to return from')
    }

    logger.info('interactive.session.returning', {
      socketId,
      childAgent: session.childAgentName,
      parentAgent: session.parentAgentName,
    })

    await this.deps.switchAgent(socketId, session.parentAgentName, summary)
  }

  handleHandoff(socketId: string, _oldAgent: string, newAgent: string): void {
    if (!this.deps) return

    const session = this.sessions.get(socketId)
    if (!session) return

    if (newAgent === session.childAgentName) {
      logger.info('interactive.handoff.to_child', {
        socketId,
        childAgent: session.childAgentName,
      })
    } else if (newAgent === session.parentAgentName) {
      this.sessions.delete(socketId)
      logger.info('interactive.handoff.to_parent', {
        socketId,
        parentAgent: session.parentAgentName,
      })
    }
  }

  isInteractiveAgent(socketId: string, agentName: string): boolean {
    const session = this.sessions.get(socketId)
    return session?.childAgentName === agentName
  }

  hasActiveSession(socketId: string): boolean {
    return this.sessions.has(socketId)
  }

  getSession(socketId: string): InteractiveSession | undefined {
    return this.sessions.get(socketId)
  }

  cleanup(socketId: string): void {
    this.sessions.delete(socketId)
  }
}

export const interactiveSubAgentManager = new InteractiveSubAgentManager()

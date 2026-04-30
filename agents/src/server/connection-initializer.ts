export interface AgentInfo {
  id: string
  name: string
  description?: string
}

export interface ConnectionInitData {
  agents: AgentInfo[]
  serverConfig: { version: string; capabilities: string[] }
}

interface AgentFactory {
  agents: { list: () => AgentInfo[] }
}

export class ConnectionInitializer {
  constructor(
    private getAgentFactory: () => AgentFactory | null,
    private config: { version: string },
  ) {}

  initialize(): ConnectionInitData {
    const factory = this.getAgentFactory()
    const agents = factory?.agents.list() ?? []

    return {
      agents,
      serverConfig: {
        version: this.config.version,
        capabilities: ['streaming', 'tools', 'client_actions'],
      },
    }
  }
}

import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'http'
import { Agent } from '../core/agent'
import { createStreamingAgenticRunner } from '../core/streaming-agentic-runner'
import { 
  WebSocketServerConfig, 
  ChatMessageData, 
  StreamingResult, 
  CompletionData,
  AgentFactory
} from './types'

export class WebSocketServer {
  private io: SocketIOServer
  private agent?: Agent // Single agent (legacy mode)
  private agents: Map<string, Agent> = new Map() // Multiple agents (pre-initialized)
  private agentFactories: Map<string, AgentFactory<any>> = new Map() // Agent factories for dynamic creation
  private streamingRunners: Map<string, ReturnType<typeof createStreamingAgenticRunner>> = new Map()
  private config: WebSocketServerConfig
  private isMultiAgent: boolean
  private isDynamicAgents: boolean

  constructor(httpServer: HTTPServer, config: WebSocketServerConfig) {
    this.config = config
    this.isMultiAgent = !!config.agents || !!config.agentFactories
    this.isDynamicAgents = !!config.agentFactories
    
    if (this.isMultiAgent) {
      // Multi-agent mode
      if (this.isDynamicAgents) {
        // Dynamic agent creation mode
        if (!config.agentFactories || Object.keys(config.agentFactories).length === 0) {
          throw new Error('Dynamic agent mode requires at least one agent factory in config.agentFactories')
        }
        
        // Store agent factories for dynamic creation
        for (const [agentId, factory] of Object.entries(config.agentFactories)) {
          this.agentFactories.set(agentId, factory)
        }
        
        // Validate default agent if specified
        if (config.defaultAgent && !this.agentFactories.has(config.defaultAgent)) {
          throw new Error(`Default agent '${config.defaultAgent}' not found in agentFactories`)
        }
      } else {
        // Pre-initialized agent mode
        if (!config.agents || Object.keys(config.agents).length === 0) {
          throw new Error('Multi-agent mode requires at least one agent in config.agents')
        }
        
        // Initialize all agents
        for (const [agentId, agentConfig] of Object.entries(config.agents)) {
          const agent = agentConfig instanceof Agent ? agentConfig : new Agent(agentConfig)
          this.agents.set(agentId, agent)
          this.streamingRunners.set(agentId, createStreamingAgenticRunner(agent))
        }
        
        // Validate default agent if specified
        if (config.defaultAgent && !this.agents.has(config.defaultAgent)) {
          throw new Error(`Default agent '${config.defaultAgent}' not found in agents`)
        }
      }
    } else {
      // Single agent mode (legacy)
      if (!config.agent) {
        throw new Error('Single agent mode requires config.agent to be specified')
      }
      
      this.agent = config.agent instanceof Agent ? config.agent : new Agent(config.agent)
      this.streamingRunners.set('default', createStreamingAgenticRunner(this.agent))
    }
    
    // Initialize Socket.IO server
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: config.cors?.origin ?? (process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000']),
        methods: config.cors?.methods ?? ['GET', 'POST']
      },
      ...config.socketOptions
    })
    
    this.setupEventHandlers()
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      const socketId = socket.id
      console.log('Client connected:', socketId)
      this.config.onConnection?.(socketId)

      // Send agent information to client
      if (this.isMultiAgent) {
        const agentList = this.isDynamicAgents 
          ? Array.from(this.agentFactories.keys()).map(agentId => ({
              id: agentId,
              name: agentId, // For dynamic agents, we don't have the name until creation
              description: 'Dynamic agent - created per conversation',
            }))
          : Array.from(this.agents.keys()).map(agentId => ({
              id: agentId,
              name: this.agents.get(agentId)?.getConfig().name || agentId,
              description: this.agents.get(agentId)?.getConfig().systemPrompt?.substring(0, 100) + '...' || '',
            }))
        
        socket.emit('agents_available', {
          type: 'agents_available',
          agents: agentList,
          defaultAgent: this.config.defaultAgent || agentList[0]?.id
        })
      }

      socket.on('chat_message', async (data: ChatMessageData) => {
        await this.handleChatMessage(socket, data)
      })

      socket.on('get_agents', () => {
        // Allow clients to request agent list at any time
        if (this.isMultiAgent) {
          const agentList = this.isDynamicAgents 
            ? Array.from(this.agentFactories.keys()).map(agentId => ({
                id: agentId,
                name: agentId, // For dynamic agents, we don't have the name until creation
                description: 'Dynamic agent - created per conversation',
              }))
            : Array.from(this.agents.keys()).map(agentId => ({
                id: agentId,
                name: this.agents.get(agentId)?.getConfig().name || agentId,
                description: this.agents.get(agentId)?.getConfig().systemPrompt?.substring(0, 100) + '...' || '',
              }))
          
          socket.emit('agents_available', {
            type: 'agents_available',
            agents: agentList,
            defaultAgent: this.config.defaultAgent || agentList[0]?.id
          })
        } else {
          socket.emit('agents_available', {
            type: 'agents_available',
            agents: [{
              id: 'default',
              name: this.agent?.getConfig().name || 'AI Assistant',
              description: this.agent?.getConfig().systemPrompt?.substring(0, 100) + '...' || '',
            }],
            defaultAgent: 'default'
          })
        }
      })

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socketId)
        this.config.onDisconnection?.(socketId)
      })
    })
  }

  private async handleChatMessage(socket: any, data: ChatMessageData) {
    const startTime = Date.now()
    const socketId = socket.id
    const { message, files, agentId, context: messageContext } = data

    // Determine which agent to use and create/get streaming runner
    let selectedAgentId: string
    let streamingRunner: ReturnType<typeof createStreamingAgenticRunner>
    
    if (this.isMultiAgent) {
      if (this.isDynamicAgents) {
        // Dynamic agent mode: create agent per message
        const availableFactories = Array.from(this.agentFactories.keys())
        if (availableFactories.length === 0) {
          socket.emit('error', {
            type: 'error',
            content: 'No agent factories available',
            data: { availableFactories }
          })
          return
        }
        
        selectedAgentId = agentId || this.config.defaultAgent || availableFactories[0]!
        
        if (!this.agentFactories.has(selectedAgentId)) {
          socket.emit('error', {
            type: 'error',
            content: `Agent factory '${selectedAgentId}' not found`,
            data: { 
              availableFactories: Array.from(this.agentFactories.keys()),
              requestedAgent: selectedAgentId
            }
          })
          return
        }
        
        try {
          // Extract context using the configured extractor
          const extractedContext = this.config.contextExtractor 
            ? this.config.contextExtractor(messageContext || {})
            : messageContext || {}
          
          // Create agent dynamically with context
          const factory = this.agentFactories.get(selectedAgentId)!
          const agent = await factory(extractedContext)
          streamingRunner = createStreamingAgenticRunner(agent)
        } catch (error) {
          socket.emit('error', {
            type: 'error',
            content: `Failed to create agent '${selectedAgentId}': ${error instanceof Error ? error.message : String(error)}`,
            data: { agentId: selectedAgentId }
          })
          return
        }
      } else {
        // Pre-initialized agent mode
        const availableAgents = Array.from(this.agents.keys())
        if (availableAgents.length === 0) {
          socket.emit('error', {
            type: 'error',
            content: 'No agents available',
            data: { availableAgents }
          })
          return
        }
        
        selectedAgentId = agentId || this.config.defaultAgent || availableAgents[0]!
        
        if (!this.agents.has(selectedAgentId)) {
          socket.emit('error', {
            type: 'error',
            content: `Agent '${selectedAgentId}' not found`,
            data: { 
              availableAgents: Array.from(this.agents.keys()),
              requestedAgent: selectedAgentId
            }
          })
          return
        }
        
        const runner = this.streamingRunners.get(selectedAgentId)
        if (!runner) {
          socket.emit('error', {
            type: 'error',
            content: `Streaming runner for agent '${selectedAgentId}' not found`
          })
          return
        }
        streamingRunner = runner
      }
    } else {
      // Single agent mode (legacy)
      selectedAgentId = 'default'
      streamingRunner = this.streamingRunners.get('default')!
    }

    console.log('💬 Processing message:', { 
      socketId, 
      agentId: selectedAgentId,
      hasFiles: !!files, 
      fileCount: files?.length || 0 
    })
    this.config.onMessageStart?.(socketId, message)
    
    try {
      // Emit initial status
      socket.emit('status', { 
        type: 'status', 
        content: 'Processing...', 
        data: { status: 'thinking' } 
      })

      // Initialize streaming state
      let stepCount = 0
      let finalResult: StreamingResult | null = null
      const allToolCalls: unknown[] = []
      
      // Process files if provided
      if (files && files.length > 0) {
        
        socket.emit('status', { 
          type: 'status', 
          content: 'Processing uploaded files...', 
          data: { status: 'processing' } 
        })

        try {
          // Import file processing utilities
          const { createFileInput } = await import('../index.js')
          
          // Convert uploaded files to FileInput format
          const fileInputs = files.map(file => {
            const fileInput = createFileInput(file.filepath)
            fileInput.description = `User uploaded file: ${file.originalName}`
            return fileInput
          })
          
          // Create context for file processing (merge message context if provided)
          const fileContext = messageContext ? { ...messageContext } : {}
          
          // Use selected agent's file processing with streaming
          const selectedAgent = this.isMultiAgent ? this.agents.get(selectedAgentId)! : this.agent!
          const generator = selectedAgent.processFilesStream(fileInputs, message, fileContext)
          
          let chunkCount = 0
          let generatorResult: IteratorResult<string, any>
          
          // Handle generator properly - it yields strings and returns the final result
          while (true) {
            generatorResult = await generator.next()
            
            if (generatorResult.done) {
              // Generator completed - generatorResult.value is the final result
              break
            } else {
              // Generator yielded a string chunk
              chunkCount++
              
              // Stream text chunk
              socket.emit('chunk', {
                type: 'chunk',
                content: generatorResult.value,
                data: { step: 1 }
              })
            }
          }
          
          
          const fileProcessingResult = generatorResult.value
          
          // Extract final result and normalize tool outputs
          if (fileProcessingResult) {
            let accumulatedContent = fileProcessingResult.content || ''
            
            // Extract and emit content from tool calls as text chunks
            if (fileProcessingResult.toolCalls && fileProcessingResult.toolCalls.length > 0) {
              for (const toolCall of fileProcessingResult.toolCalls) {
                // Emit tool start event
                socket.emit('tool_start', {
                  type: 'tool_start',
                  content: `Using ${toolCall.name}...`,
                  data: {
                    step: 1,
                    tool: toolCall
                  }
                })
                
                // Extract and emit renderable content from tool results
                let toolContent = ''
                if (toolCall.name === 'html_file_editor' && toolCall.input?.content) {
                  toolContent = `I've created an HTML page based on your image. Here's the generated code:\n\n\`\`\`html\n${toolCall.input.content}\n\`\`\``
                } else if (toolCall.result && typeof toolCall.result === 'object') {
                  // For other tools, extract meaningful content
                  const resultStr = JSON.stringify(toolCall.result, null, 2)
                  toolContent = `**${toolCall.name} Result:**\n\n\`\`\`json\n${resultStr}\n\`\`\``
                }
                
                if (toolContent) {
                  // Emit tool content as text chunk
                  socket.emit('chunk', {
                    type: 'chunk',
                    content: toolContent,
                    data: {
                      step: 1,
                      source: 'tool_output'
                    }
                  })
                  
                  // Accumulate for final content
                  accumulatedContent += (accumulatedContent ? '\n\n' : '') + toolContent
                }
                
                // Emit tool completion event
                socket.emit('tool_result', {
                  type: 'tool_result',
                  content: `${toolCall.name} completed`,
                  data: {
                    step: 1,
                    tool: toolCall
                  }
                })
              }
            }
            
            finalResult = {
              content: accumulatedContent,
              toolCalls: fileProcessingResult.toolCalls || [],
              usage: fileProcessingResult.usage
            }
          }
          
          // Emit completion event with file context
          const completeData = {
            type: 'complete',
            content: finalResult?.content || '',
            data: {
              totalSteps: 1,
              usage: finalResult?.usage || undefined,
              toolCalls: finalResult?.toolCalls || [],
              fileContext: {
                files: files.map(f => ({ name: f.originalName, size: f.size })),
                fileCount: files.length
              }
            }
          }
          
          
          socket.emit('complete', completeData)
          return
          
        } catch (error) {
          console.error('❌ Error processing files:', error instanceof Error ? error.message : 'Unknown error')
          
          socket.emit('error', {
            type: 'error',
            content: 'Failed to process uploaded files',
            data: { error: error instanceof Error ? error.message : 'Unknown error' }
          })
          return
        }
      }
      
      // Create context for tools (merge message context if provided)
      const context = messageContext ? { ...messageContext } : {}
      
      // Start streaming agentic loop for regular messages
      const stream = streamingRunner.runStreamingLoop(message, {
        maxSteps: this.config.maxSteps ?? 5,
        context,
        onEvent: async (event) => {
          switch (event.type) {
            case 'step_start':
              socket.emit('step_start', {
                type: 'step_start',
                content: '',
                data: event.data
              })
              break
              
            case 'text_chunk':
              socket.emit('chunk', {
                type: 'chunk',
                content: event.content,
                data: {
                  step: event.step,
                  position: event.data?.position
                }
              })
              break
              
            case 'tool_start':
              socket.emit('tool_start', {
                type: 'tool_start',
                content: event.content,
                data: {
                  step: event.step,
                  tool: event.data?.tool
                }
              })
              break
              
            case 'tool_result':
              allToolCalls.push(event.data?.tool)
              socket.emit('tool_result', {
                type: 'tool_result',
                content: event.content,
                data: {
                  step: event.step,
                  tool: event.data?.tool
                }
              })
              break
              
            case 'step_complete':
              stepCount = event.step
              socket.emit('step_complete', {
                type: 'step_complete',
                content: event.content,
                data: {
                  step: event.step,
                  toolCalls: event.data?.toolCalls,
                  isFinal: event.data?.isFinal,
                  usage: event.data?.usage
                }
              })
              
              if (event.data?.isFinal) {
                finalResult = {
                  content: event.content || '',
                  toolCalls: allToolCalls,
                  usage: event.data?.usage
                }
              }
              break
          }
        }
      })

      // Consume the stream
      for await (const _event of stream) {
        // Events are handled in the onEvent callback above
      }

      // Prepare completion data
      const result = finalResult as StreamingResult | null
      
      
      const completeData: CompletionData = {
        type: 'complete',
        content: result?.content || '',
        data: {
          totalSteps: stepCount,
          usage: (this.config.includeUsageData !== false) ? (result?.usage || undefined) : undefined,
          toolCalls: result?.toolCalls || [],
          agentId: selectedAgentId
        }
      }
      
      // Calculate metrics and emit completion
      const duration = Date.now() - startTime
      const toolNames = allToolCalls
        .map((tool) => (tool as Record<string, unknown>)?.name)
        .filter(Boolean) as string[]
      
      const completionMetrics = {
        steps: stepCount,
        toolCount: toolNames.length,
        tools: toolNames,
        duration: `${duration}ms`,
        agentId: selectedAgentId
      }
      
      console.log('✅ Completed:', { 
        socketId, 
        agentId: selectedAgentId,
        duration: `${duration}ms`, 
        steps: stepCount, 
        tools: toolNames 
      })
      
      this.config.onMessageComplete?.(socketId, completionMetrics)
      
      socket.emit('complete', completeData)
      socket.emit('status', { 
        type: 'status', 
        content: 'Complete', 
        data: { status: 'complete' } 
      })

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      
      console.error('❌ Error processing message:', { socketId, error: err.message })
      
      this.config.onError?.(socketId, err, message)
      
      socket.emit('error', {
        type: 'error',
        content: 'Sorry, there was an error processing your message.',
        data: { error: err.message }
      })
      
      socket.emit('status', { 
        type: 'status', 
        content: 'Error occurred', 
        data: { status: 'error' } 
      })
    }
  }

  /**
   * Get the Socket.IO server instance for additional customization
   */
  getSocketIOServer(): SocketIOServer {
    return this.io
  }


  /**
   * Close the WebSocket server
   */
  close(): void {
    this.io.close()
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.io.engine.clientsCount
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(event: string, data: any): void {
    this.io.emit(event, data)
  }

  /**
   * Send a message to a specific client
   */
  sendToClient(socketId: string, event: string, data: any): void {
    this.io.to(socketId).emit(event, data)
  }

  /**
   * Get list of available agents
   */
  getAvailableAgents(): Array<{id: string, name: string, description: string}> {
    if (this.isMultiAgent) {
      return Array.from(this.agents.keys()).map(agentId => ({
        id: agentId,
        name: this.agents.get(agentId)?.getConfig().name || agentId,
        description: this.agents.get(agentId)?.getConfig().systemPrompt?.substring(0, 100) + '...' || '',
      }))
    } else {
      return [{
        id: 'default',
        name: this.agent?.getConfig().name || 'AI Assistant',
        description: this.agent?.getConfig().systemPrompt?.substring(0, 100) + '...' || '',
      }]
    }
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId?: string): Agent | undefined {
    if (this.isMultiAgent) {
      const availableAgents = Array.from(this.agents.keys())
      if (availableAgents.length === 0) return undefined
      
      const id = agentId || this.config.defaultAgent || availableAgents[0]!
      return this.agents.get(id)
    } else {
      return this.agent
    }
  }

  /**
   * Check if server is in multi-agent mode
   */
  isMultiAgentMode(): boolean {
    return this.isMultiAgent
  }

  /**
   * Get agent count
   */
  getAgentCount(): number {
    return this.isMultiAgent ? this.agents.size : 1
  }
}

/**
 * Factory function to create and setup a WebSocket server
 */
export function createWebSocketServer(
  httpServer: HTTPServer, 
  config: WebSocketServerConfig
): WebSocketServer {
  return new WebSocketServer(httpServer, config)
}

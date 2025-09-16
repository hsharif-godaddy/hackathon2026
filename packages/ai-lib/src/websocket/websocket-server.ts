import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'http'
import { Agent } from '../core/agent'
import { createStreamingAgenticRunner } from '../core/streaming-agentic-runner'
import { 
  WebSocketServerConfig, 
  ChatMessageData, 
  StreamingResult, 
  CompletionData 
} from './types'

export class WebSocketServer {
  private io: SocketIOServer
  private agent: Agent
  private streamingRunner: ReturnType<typeof createStreamingAgenticRunner>
  private config: WebSocketServerConfig

  constructor(httpServer: HTTPServer, config: WebSocketServerConfig) {
    this.config = config
    
    // Create agent instance if config was provided instead of Agent instance
    if (config.agent instanceof Agent) {
      this.agent = config.agent
    } else {
      this.agent = new Agent(config.agent)
    }
    
    this.streamingRunner = createStreamingAgenticRunner(this.agent)
    
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

      socket.on('chat_message', async (data: ChatMessageData) => {
        await this.handleChatMessage(socket, data)
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
    const { message, files } = data

    console.log('💬 Processing message:', { socketId, hasFiles: !!files, fileCount: files?.length || 0 })
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
          
          // Use agent's file processing with streaming
          const generator = this.agent.processFilesStream(fileInputs, message)
          
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
      
      // Start streaming agentic loop for regular messages
      const stream = this.streamingRunner.runStreamingLoop(message, {
        maxSteps: this.config.maxSteps ?? 5,
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
          toolCalls: result?.toolCalls || []
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
        duration: `${duration}ms`
      }
      
      console.log('✅ Completed:', { socketId, duration: `${duration}ms`, steps: stepCount, tools: toolNames })
      
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
   * Get the agent instance
   */
  getAgent(): Agent {
    return this.agent
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

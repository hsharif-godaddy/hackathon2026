/**
 * Experimental WebSocket Server Demo
 *
 * This example demonstrates the new ExperimentalWebSocketServer with:
 * - Simplified setup using AgentFactory
 * - Single agent helper factory
 * - Multi-agent support
 * - Conversation history and context handling
 */

import 'dotenv/config'
import { createServer } from 'http'
import { getModel } from '../src/providers/unified-provider.js'
import { createAgentFactory } from '../src/core/agent-factory.js'
import {
  createExperimentalWebSocketServer,
  createSingleAgentWebSocketServer
} from '../src/websocket/experimental-websocket-server.js'
import { createTool } from '../src/tools/base-tool.js'
import { z } from 'zod'

// Simple tools for demonstration
const weatherTool = createTool(
  'Get weather information for a city',
  z.object({
    city: z.string().describe('The city to get weather for'),
    units: z.string().optional().describe('Temperature units (celsius or fahrenheit)')
  }),
  async ({ city, units = 'celsius' }) => {
    // Simulate weather API call
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      city,
      temperature: 22,
      condition: 'Sunny',
      humidity: 65,
      units,
      timestamp: new Date().toISOString()
    }
  }
)

const timeTool = createTool(
  'Get current time',
  z.object({
    timezone: z.string().optional().describe('Timezone (e.g., UTC, America/New_York)')
  }),
  async ({ timezone = 'UTC' }) => {
    return {
      time: new Date().toLocaleString('en-US', { timeZone: timezone }),
      timezone,
      timestamp: new Date().toISOString()
    }
  }
)

// Helper function for single agent usage example
function showUsageExample(port: number) {
  console.log('\n📝 Client usage example:')
  console.log(`const socket = io("http://localhost:${port}")`)
  console.log('socket.emit("chat", { message: "What\'s the weather in Tokyo?" })')
  console.log('socket.on("message", (data) => {')
  console.log('  if (data.type === "chunk") console.log(data.content)')
  console.log('  if (data.type === "complete") console.log("Done:", data.data)')
  console.log('})')
  console.log('\n⚠️  Press Ctrl+C to stop the server')
}

async function singleAgentDemo() {
  console.log('🚀 Starting Single Agent WebSocket Demo...')

  // Create HTTP server
  const httpServer = createServer()

  try {
    // Create single agent WebSocket server using helper
    const wsServer = createSingleAgentWebSocketServer(
      httpServer,
      'assistant', // Agent name
      {
        name: 'AI Assistant',
        system: `You are a helpful AI assistant. You can help with various tasks including checking weather and time. Always be friendly and helpful.`,
        model: await getModel('gpt4o-mini'),
        tools: {
          weather: weatherTool,
          time: timeTool
        },
        temperature: 0.7,
        maxOutputTokens: 1000,
        maxSteps: 3
      },
      {
        // Optional configuration
        includeUsageData: true,
        cors: {
          origin: "*",
          methods: ["GET", "POST"]
        },
        onConnection: (socketId) => {
          console.log(`🔌 Client connected: ${socketId}`)
        },
        onDisconnection: (socketId) => {
          console.log(`🔌 Client disconnected: ${socketId}`)
        },
        onMessageStart: (socketId, message, agentName) => {
          console.log(`💬 [${agentName}] Message from ${socketId}: ${message.substring(0, 50)}...`)
        },
        onMessageComplete: (socketId, result) => {
          console.log(`✅ [${result.agentName}] Completed in ${result.duration}`)
          if (result.usage) {
            console.log(`📊 Usage:`, result.usage)
          }
        },
        onError: (socketId, error, message) => {
          console.error(`❌ Error for ${socketId}:`, error.message)
        }
      }
    )

    // Start server with error handling
    const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 3001

    httpServer.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️  Port ${PORT} is in use, trying port ${PORT + 1}`)
        httpServer.listen(PORT + 1, () => {
          console.log(`✅ Single Agent WebSocket Server running on port ${PORT + 1}`)
          console.log(`🌐 Connect to: http://localhost:${PORT + 1}`)
          showUsageExample(PORT + 1)
        })
      } else {
        console.error(`❌ Server error:`, err)
        process.exit(1)
      }
    })

    httpServer.listen(PORT, () => {
      console.log(`✅ Single Agent WebSocket Server running on port ${PORT}`)
      console.log(`🌐 Connect to: http://localhost:${PORT}`)
      showUsageExample(PORT)
    })

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down server...')
      wsServer.close()
      httpServer.close()
      process.exit(0)
    })

  } catch (error) {
    console.error('❌ Failed to start single agent demo:', error)
    process.exit(1)
  }
}

// Helper function for multi-agent usage example
function showMultiAgentUsage(port: number, agentList: string[]) {
  console.log('\n🤖 Available agents:', agentList.join(', '))
  console.log('\n📝 Client usage examples:')
  console.log(`const socket = io("http://localhost:${port}")`)
  console.log('')
  console.log('// Use default agent (general)')
  console.log('socket.emit("chat", { message: "Hello!" })')
  console.log('')
  console.log('// Use specific agent (agentId or agentName supported)')
  console.log('socket.emit("chat", { message: "What\'s the weather?", agentId: "weather" })')
  console.log('')
  console.log('// With context and history')
  console.log('socket.emit("chat", {')
  console.log('  message: "Continue the story",')
  console.log('  agentId: "creative",')
  console.log('  context: { userPreferences: { genre: "sci-fi" } },')
  console.log('  conversationHistory: [')
  console.log('    { role: "user", content: "Write a story about space" },')
  console.log('    { role: "assistant", content: "Once upon a time..." }')
  console.log('  ]')
  console.log('})')
  console.log('')
  console.log('// Listen for normalized events')
  console.log('socket.on("message", (data) => {')
  console.log('  switch(data.type) {')
  console.log('    case "agents_available": console.log("Agents:", data.data.agents)')
  console.log('    case "chunk": process.stdout.write(data.content)')
  console.log('    case "complete": console.log("\\nDone:", data.data.agentId)')
  console.log('  }')
  console.log('})')
  console.log('\n⚠️  Press Ctrl+C to stop the server')
}

async function multiAgentDemo() {
  console.log('🚀 Starting Multi-Agent WebSocket Demo...')

  // Create HTTP server
  const httpServer = createServer()

  try {
    // Create agent factory with multiple agents
    const agentFactory = createAgentFactory()

    const agents = agentFactory.defineAgents({
      general: {
        name: 'General Assistant',
        system: `You are a helpful general assistant. Keep responses concise and friendly.`,
        model: await getModel('gpt4o-mini'),
        temperature: 0.7,
        maxOutputTokens: 500,
        maxSteps: 2
      },

      weather: {
        name: 'Weather Specialist',
        system: `You are a weather specialist. Use the weather tool to provide accurate weather information. Be detailed about weather conditions.`,
        model: await getModel('gpt4o-mini'),
        tools: {
          weather: weatherTool,
          time: timeTool
        },
        temperature: 0.3,
        maxOutputTokens: 800,
        maxSteps: 3
      },

      creative: {
        name: 'Creative Writer',
        system: `You are a creative writing assistant. Help with stories, poems, and creative content. Be imaginative and inspiring.`,
        model: await getModel('gpt4o'),
        temperature: 0.9,
        maxOutputTokens: 1500,
        maxSteps: 2
      }
    })

    // Create multi-agent WebSocket server
    const wsServer = createExperimentalWebSocketServer(httpServer, {
      agentFactory,
      defaultAgent: 'general',
      includeUsageData: true,
      contextExtractor: (rawContext) => {
        // Extract and process custom context
        return {
          userPreferences: rawContext.userPreferences || {},
          location: rawContext.location || 'Unknown',
          timestamp: new Date().toISOString()
        }
      },
      onConnection: (socketId) => {
        console.log(`🔌 Client connected: ${socketId}`)
      },
      onMessageStart: (socketId, message, agentName) => {
        console.log(`💬 [${agentName}] Message from ${socketId}: ${message.substring(0, 50)}...`)
      },
      onMessageComplete: (socketId, result) => {
        console.log(`✅ [${result.agentName}] Completed in ${result.duration}`)
      }
    })

    // Start server with error handling
    const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 3002

    httpServer.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️  Port ${PORT} is in use, trying port ${PORT + 1}`)
        httpServer.listen(PORT + 1, () => {
          console.log(`✅ Multi-Agent WebSocket Server running on port ${PORT + 1}`)
          console.log(`🌐 Connect to: http://localhost:${PORT + 1}`)
          showMultiAgentUsage(PORT + 1, agents.list())
        })
      } else {
        console.error(`❌ Server error:`, err)
        process.exit(1)
      }
    })

    httpServer.listen(PORT, () => {
      console.log(`✅ Multi-Agent WebSocket Server running on port ${PORT}`)
      console.log(`🌐 Connect to: http://localhost:${PORT}`)
      showMultiAgentUsage(PORT, agents.list())
    })

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down server...')
      wsServer.close()
      httpServer.close()
      process.exit(0)
    })

  } catch (error) {
    console.error('❌ Failed to start multi-agent demo:', error)
    process.exit(1)
  }
}

// Determine which demo to run
const demoType = process.argv[2] || 'single'

if (demoType === 'multi') {
  multiAgentDemo()
} else {
  singleAgentDemo()
}

// Export for programmatic use
export { singleAgentDemo, multiAgentDemo }

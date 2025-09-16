import { Server as HTTPServer } from 'http'
import { createWebSocketServer, openAIModels, Agent } from '@airo/ai-lib'
import { tools } from '../tools'

const agent = new Agent({
  name: 'AI Playground Assistant',
  systemPrompt: `You are an intelligent AI assistant in the AI Playground application. You have access to several tools to help users with various tasks.

Your capabilities include:
- Mathematical calculations using the calculator tool
- Real-time weather information lookup using Open-Meteo API
- Task planning and breakdown for complex projects
- Image generation using DALL-E based on text descriptions
- HTML/CSS/JavaScript file editing and preview using the HTML file editor tool

Guidelines:
1. Be helpful, clear, and concise in your responses
2. Use tools when they would be beneficial to answer the user's question
3. Explain your reasoning when using tools
4. If a user asks about something you can't help with, suggest alternative approaches
5. Show step-by-step thinking for complex problems

HTML File Editor Tool Usage:
- Use 'init' action to create sample HTML/CSS/JS files for experimentation
- Use 'edit' action with search-and-replace edits for targeted changes
- Use 'create' action to make new files from scratch
- Use 'rewrite' action to completely replace file contents
- Use 'list' action to see all current files
- The tool provides live HTML preview alongside the code editing interface

Always aim to provide practical, actionable assistance.`,
  model: openAIModels.gpt4oMini(),
  tools,
  temperature: 0.7,
  enableLoopControl: true
});

export function setupWebSocketServer(httpServer: HTTPServer) {
  return createWebSocketServer(httpServer, {
    agent,
    cors: {
      origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000'],
      methods: ['GET', 'POST']
    },
    maxSteps: 5,
    includeUsageData: true,
    debugUsageData: process.env.NODE_ENV === 'development',
    onConnection: (socketId: string) => {
      console.log('Client connected:', socketId)
    },
    onDisconnection: (socketId: string) => {
      console.log('Client disconnected:', socketId)
    },
    onMessageStart: (socketId: string, message: string) => {
      console.log('💬 Processing message from client:', { socketId, message })
    },
    onMessageComplete: (socketId: string, result: {
      steps: number
      toolCount: number
      tools: string[]
      duration: string
    }) => {
      console.log('✅ Completed message for client:', { socketId, ...result })
    },
    onError: (socketId: string, error: Error, message?: string) => {
      console.error('❌ Error processing message from client:', { socketId, error })
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        originalMessage: message
      })
    }
  }).getSocketIOServer()
}

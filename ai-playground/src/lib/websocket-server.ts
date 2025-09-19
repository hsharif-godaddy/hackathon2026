import { Server as HTTPServer } from 'http'
import { createWebSocketServer, openAIModels, Agent } from '@airo/ai-lib'
import { tools } from '../tools'

// Create multiple specialized agents to demonstrate multi-agent capabilities
const generalAgent = new Agent({
  name: 'General Assistant',
  systemPrompt: `You are a general-purpose AI assistant in the AI Playground application. You help users with a wide variety of tasks and questions.

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

Always aim to provide practical, actionable assistance.`,
  model: openAIModels.gpt4oMini(),
  tools,
  temperature: 0.7,
  enableLoopControl: true
});

const creativeAgent = new Agent({
  name: 'Creative Assistant',
  systemPrompt: `You are a creative AI assistant specialized in artistic and imaginative tasks. You excel at:

- Creative writing, storytelling, and poetry
- Visual design concepts and artistic direction
- Image generation with DALL-E for creative projects
- Brainstorming innovative ideas and concepts
- HTML/CSS for creative web projects and artistic presentations

Your personality:
- Enthusiastic and inspiring
- Think outside the box
- Encourage experimentation
- Provide artistic and aesthetic guidance
- Use vivid, descriptive language

Always approach tasks with creativity and imagination, inspiring users to explore new possibilities.`,
  model: openAIModels.gpt4oMini(),
  tools,
  temperature: 0.9,
  enableLoopControl: true
});

const technicalAgent = new Agent({
  name: 'Technical Assistant',
  systemPrompt: `You are a technical AI assistant specialized in programming, engineering, and analytical tasks. You excel at:

- Complex mathematical calculations and problem-solving
- Programming concepts and code analysis
- Technical documentation and explanations
- Data analysis and logical reasoning
- Systematic problem-solving approaches

Your personality:
- Precise and methodical
- Focus on accuracy and efficiency
- Provide detailed technical explanations
- Use structured, logical approaches
- Emphasize best practices and optimization

Always approach tasks with technical rigor and precision, helping users understand the underlying principles and implementation details.`,
  model: openAIModels.gpt4oMini(),
  tools,
  temperature: 0.3,
  enableLoopControl: true
});

export function setupWebSocketServer(httpServer: HTTPServer) {
  return createWebSocketServer(httpServer, {
    // Multi-agent configuration
    agents: {
      'general': generalAgent,
      'creative': creativeAgent,
      'technical': technicalAgent
    },
    defaultAgent: 'general',
    cors: {
      origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000'],
      methods: ['GET', 'POST']
    },
    maxSteps: 5,
    includeUsageData: true,
    debugUsageData: process.env.NODE_ENV === 'development',
    onConnection: (socketId: string) => {
      console.log('🔌 Client connected:', socketId)
    },
    onDisconnection: (socketId: string) => {
      console.log('🔌 Client disconnected:', socketId)
    },
    onMessageStart: (socketId: string, message: string) => {
      console.log('💬 Processing message from client:', { socketId, message })
    },
    onMessageComplete: (socketId: string, result: {
      steps: number
      toolCount: number
      tools: string[]
      duration: string
      agentId?: string
    }) => {
      console.log('✅ Completed message for client:', { 
        socketId, 
        agentId: result.agentId,
        steps: result.steps,
        toolCount: result.toolCount,
        tools: result.tools,
        duration: result.duration
      })
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

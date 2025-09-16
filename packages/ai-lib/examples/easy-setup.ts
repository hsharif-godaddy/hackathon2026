/**
 * Easy setup example with automatic provider detection
 * 
 * Setup:
 * 1. Copy env.example to .env
 * 2. Fill in your API keys
 * 3. npm install @ai-sdk/openai (or your preferred provider)
 * 4. npx tsx examples/easy-setup.ts
 */

import { AgentFactory } from '../src/index.js'
import { createWebSearchTool, createFileOperationTools } from '../src/tools/built-in/index.js'
import { EnvConfig } from '../src/utils/env-config.js'

// Dynamic imports to avoid requiring all providers
async function createProviderModel(provider: string, model: string) {
  switch (provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY || '',
        ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {})
      })
      return openai(model)
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY || ''
      })
      return anthropic(model)
    }
    case 'bedrock': {
      const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock')
      const bedrock = createAmazonBedrock({
        region: process.env.AWS_REGION || 'us-west-2'
      })
      return bedrock(model)
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

async function main() {
  console.log('🚀 AI Library Easy Setup Example\n')

  // Print environment status
  EnvConfig.printStatus()

  // Get default configuration
  const config = EnvConfig.getDefaultConfig()
  
  // Validate provider is properly configured
  if (!EnvConfig.validateProvider(config.provider)) {
    console.error(`❌ Provider '${config.provider}' is not properly configured.`)
    console.error('   Please check your .env file and ensure API keys are set.')
    console.error('   Copy env.example to .env and fill in your credentials.')
    process.exit(1)
  }

  try {
    // Create model instance
    console.log(`📡 Creating ${config.provider} model: ${config.model}`)
    const model = await createProviderModel(config.provider, config.model)

    // Create tools
    const webSearchTool = createWebSearchTool()
    const fileTools = createFileOperationTools()

    // Create agent factory
    const agentFactory = new AgentFactory({
      defaultTemperature: 0.7,
      globalTools: [webSearchTool.toAISDKTool()]
    })

    // Define agents with the configured model
    const agents = agentFactory.defineAgents({
      assistant: {
        name: 'General Assistant',
        systemPrompt: 'You are a helpful AI assistant. Be concise and accurate.',
        model: model as any,
        temperature: 0.7
      },

      developer: {
        name: 'Development Assistant',
        systemPrompt: 'You are an expert software developer. Help with coding tasks, debugging, and best practices.',
        model: model as any,
        temperature: 0.1,
        tools: [
          fileTools.readFile.toAISDKTool(),
          fileTools.writeFile.toAISDKTool(),
          fileTools.listDirectory.toAISDKTool()
        ]
      },

      writer: {
        name: 'Creative Writer',
        systemPrompt: 'You are a creative writing assistant. Help with storytelling and content creation.',
        model: model as any,
        temperature: 0.9,
        maxTokens: 3000
      }
    })

    console.log(`✅ Successfully configured ${agents.list().length} agents\n`)

    // Example 1: Simple generation
    console.log('1. Simple generation:')
    const assistant = agents.get('assistant')
    const response1 = await assistant.generate('What is the capital of France?')
    console.log(`Assistant: ${response1.content}\n`)

    // Example 2: Streaming
    console.log('2. Streaming response:')
    const writer = agents.get('writer')
    console.log('Writer: ')
    
    for await (const chunk of writer.generateStream('Write a very short haiku about coding')) {
      process.stdout.write(chunk)
    }
    console.log('\n')

    // Example 3: Using tools
    console.log('3. Using tools:')
    const developer = agents.get('developer')
    const toolResponse = await developer.executeWithTools('What files are in the current directory?')
    console.log(`Developer: ${toolResponse.content}`)
    if (toolResponse.toolExecutions && toolResponse.toolExecutions.length > 0) {
      console.log(`✅ Executed ${toolResponse.toolExecutions.length} tools successfully\n`)
    }

    // Example 4: Agent information
    console.log('4. Agent information:')
    console.log(`Available agents: ${agents.list().join(', ')}`)
    console.log(`Using provider: ${config.provider}`)
    console.log(`Using model: ${config.model}`)

    console.log('\n🎉 All examples completed successfully!')

  } catch (error: any) {
    console.error('❌ Example failed:', error.message)
    
    if (error.message.includes('Cannot resolve module')) {
      console.error('\n💡 Tip: Install the required provider package:')
      console.error(`   npm install @ai-sdk/${config.provider}`)
    } else if (error.message.includes('API key')) {
      console.error('\n💡 Tip: Check your API key in the .env file')
    }
    
    process.exit(1)
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

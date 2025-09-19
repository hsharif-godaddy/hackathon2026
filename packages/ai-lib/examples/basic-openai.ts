/**
 * Basic OpenAI Example with ExperimentalAgentFactory
 * 
 * This example demonstrates:
 * - Simple agent creation using OpenAI
 * - Basic text generation and streaming
 * - Usage tracking and cost calculation
 * - Proxy support via OPENAI_BASE_URL environment variable
 */

import 'dotenv/config'
import { getModel } from '../src/providers/unified-provider.js'
import { createExperimentalAgentFactory } from '../src/core/agent-factory-experimental.js'

async function main() {
  console.log('🚀 Basic OpenAI Example with ExperimentalAgentFactory\n')

  // Check for OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found. Please set your OpenAI API key.')
    process.exit(1)
  }

  try {
    console.log('🏭 Creating agent factory...')
    
    // Log proxy usage if configured
    if (process.env.OPENAI_BASE_URL) {
      console.log(`🔗 Using OpenAI proxy: ${process.env.OPENAI_BASE_URL}`)
    }
    
    // Create the agent factory
    const agentFactory = createExperimentalAgentFactory({
      defaultTemperature: 0.7,
      defaultMaxTokens: 1000
    })

    // Define agents with OpenAI models using unified provider (with automatic proxy support)
    const agents = agentFactory.defineAgents({
      assistant: {
        name: 'General Assistant',
        system: `You are a helpful AI assistant. You provide clear, concise, and accurate responses to user questions. You're friendly but professional.`,
        model: await getModel('gpt4o-mini'),
        temperature: 0.7,
        maxOutputTokens: 1000,
        maxSteps: 3  // Simple agent doesn't need many steps
      },
      
      creative: {
        name: 'Creative Writer',
        system: `You are a creative writing assistant. You help users with creative writing, storytelling, and brainstorming. Be imaginative and inspiring while maintaining quality.`,
        model: await getModel('gpt4o'),
        temperature: 0.9,  // Higher temperature for creativity
        maxOutputTokens: 2000,
        maxSteps: 3
      },
      
      technical: {
        name: 'Technical Expert',
        system: `You are a technical expert who helps with programming, software architecture, and technology questions. Provide accurate, detailed explanations with examples when helpful.`,
        model: await getModel('gpt4o'),
        temperature: 0.3,  // Lower temperature for precision
        maxOutputTokens: 1500,
        maxSteps: 3
      }
    })

    console.log(`✅ Created ${agents.list().length} agents: ${agents.list().join(', ')}\n`)

    // ==========================================
    // DEMO 1: Basic Generation (Non-streaming)
    // ==========================================
    console.log('=' + '='.repeat(60))
    console.log('DEMO 1: Basic Generation (Non-streaming)')
    console.log('=' + '='.repeat(60))

    const assistant = agents.get('assistant')
    console.log(`🤖 Using: ${assistant.getName()}`)
    
    const basicPrompt = "Explain quantum computing in simple terms for a beginner."
    console.log(`\n👤 User: ${basicPrompt}\n`)
    console.log('🤖 Assistant:')
    
    const basicResult = await assistant.generate(basicPrompt)
    console.log(basicResult.content)
    
    console.log(`\n📊 Usage: ${basicResult.usage?.totalTokens} tokens`)
    if (basicResult.usage) {
      const cost = (basicResult.usage.inputTokens / 1000 * 0.00015) + (basicResult.usage.outputTokens / 1000 * 0.0006)
      console.log(`💰 Estimated cost: $${cost.toFixed(4)}`)
    }

    // ==========================================
    // DEMO 2: Streaming Generation
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(60))
    console.log('DEMO 2: Streaming Generation')
    console.log('=' + '='.repeat(60))

    const creative = agents.get('creative')
    console.log(`🤖 Using: ${creative.getName()}`)
    
    const creativePrompt = "Write a short story about a robot who discovers emotions."
    console.log(`\n👤 User: ${creativePrompt}\n`)
    console.log('🤖 Assistant: ')
    
    const streamResult = await creative.streamGenerate(creativePrompt)
    let streamedContent = ''
    
    for await (const chunk of streamResult.textStream) {
      process.stdout.write(chunk)
      streamedContent += chunk
    }
    
    const finalResult = await streamResult.getFinalResult()
    console.log(`\n\n📊 Streamed ${streamedContent.length} characters`)
    console.log(`📊 Usage: ${finalResult.usage?.totalTokens} tokens`)
    if (finalResult.usage) {
      const cost = (finalResult.usage.inputTokens / 1000 * 0.00015) + (finalResult.usage.outputTokens / 1000 * 0.0006)
      console.log(`💰 Estimated cost: $${cost.toFixed(4)}`)
    }

    // ==========================================
    // DEMO 3: Different Agent Types
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(60))
    console.log('DEMO 3: Technical Expert Agent')
    console.log('=' + '='.repeat(60))

    const technical = agents.get('technical')
    console.log(`🤖 Using: ${technical.getName()}`)
    
    const technicalPrompt = "Explain the difference between async/await and Promises in JavaScript with a simple example."
    console.log(`\n👤 User: ${technicalPrompt}\n`)
    console.log('🤖 Assistant: ')
    
    const techStreamResult = await technical.streamGenerate(technicalPrompt)
    let techContent = ''
    
    for await (const chunk of techStreamResult.textStream) {
      process.stdout.write(chunk)
      techContent += chunk
    }
    
    const techFinalResult = await techStreamResult.getFinalResult()
    console.log(`\n\n📊 Usage: ${techFinalResult.usage?.totalTokens} tokens`)

    // ==========================================
    // SUMMARY
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(60))
    console.log('DEMO COMPLETE - SUMMARY')
    console.log('=' + '='.repeat(60))

    const totalTokens = [
      basicResult.usage?.totalTokens,
      finalResult.usage?.totalTokens,
      techFinalResult.usage?.totalTokens
    ].filter(Boolean).reduce((sum, tokens) => sum + (tokens || 0), 0)

    console.log(`\n📊 Total tokens used: ${totalTokens}`)
    console.log(`🏭 Factory stats:`, agentFactory.getStats())
    
    console.log('\n✅ OpenAI ExperimentalAgentFactory Demo Complete!')
    console.log('\n💡 Features demonstrated:')
    console.log('   ✓ Multiple specialized agents with different models and settings')
    console.log('   ✓ Both streaming and non-streaming generation')
    console.log('   ✓ Usage tracking and cost calculation')
    console.log('   ✓ Temperature control for different use cases')
    console.log('   ✓ Type-safe agent access with factory pattern')
    console.log('   ✓ Proxy support via OPENAI_BASE_URL environment variable')

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
    
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        console.error('💡 Tip: Make sure OPENAI_API_KEY is properly set')
      } else if (error.message.includes('fetch') || error.message.includes('network')) {
        console.error('💡 Tip: Check your network connection or OPENAI_BASE_URL if using a proxy')
      }
    }
    
    process.exit(1)
  }
}

main().catch(console.error)

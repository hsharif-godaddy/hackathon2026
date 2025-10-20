/**
 * Basic Bedrock Example with AgentFactory
 *
 * This example demonstrates:
 * - Simple agent creation using AWS Bedrock
 * - Basic text generation and streaming
 * - Usage tracking and cost calculation for Bedrock models
 */

import 'dotenv/config'
import { getModel } from '../src/providers/unified-provider.js'
import { createAgentFactory } from '../src/core/agent-factory.js'

async function main() {
  console.log('🚀 Basic Bedrock Example with AgentFactory\n')

  // Check for AWS credentials
  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
    console.error('❌ AWS credentials not found. Please set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or AWS_PROFILE')
    process.exit(1)
  }

  try {
    console.log('🔗 Connecting to AWS Bedrock...')

    console.log('🏭 Creating agent factory...')

    // Create the agent factory with Bedrock-specific defaults
    const agentFactory = createAgentFactory({
      defaultTemperature: 0.3,  // Conservative default for Bedrock
      defaultMaxTokens: 1500
    })

    // Define agents with different Bedrock models using unified provider
    const agents = agentFactory.defineAgents({
      assistant: {
        name: 'Claude Sonnet 4 Assistant',
        system: `You are Claude, a helpful AI assistant created by Anthropic. You provide clear, thoughtful, and accurate responses. You're knowledgeable about a wide range of topics.`,
        model: await getModel('claude4'),
        temperature: 0.3,
        maxOutputTokens: 1500,
        maxSteps: 3
      },

      quick: {
        name: 'Claude 3 Haiku (Fast)',
        system: `You are Claude 3 Haiku, a fast and efficient AI assistant. You provide concise, accurate responses quickly. Keep answers clear and to the point.`,
        model: await getModel('haiku'),
        temperature: 0.2,
        maxOutputTokens: 800,
        maxSteps: 2  // Fewer steps for quick responses
      },

      creative: {
        name: 'Claude Sonnet (Creative)',
        system: `You are Claude, optimized for creative tasks. You help with writing, brainstorming, and creative problem-solving. Be imaginative while maintaining quality and helpfulness.`,
        model: await getModel('claude4'),
        temperature: 0.7,  // Higher temperature for creativity
        maxOutputTokens: 2000,
        maxSteps: 4
      }
    })

    console.log(`✅ Created ${agents.list().length} agents: ${agents.list().join(', ')}\n`)

    // ==========================================
    // DEMO 1: Basic Generation (Non-streaming)
    // ==========================================
    console.log('=' + '='.repeat(60))
    console.log('DEMO 1: Basic Generation with Claude Sonnet')
    console.log('=' + '='.repeat(60))

    const assistant = agents.get('assistant')
    console.log(`🤖 Using: ${assistant.getName()}`)

    const basicPrompt = "Explain the benefits of serverless computing and when you might choose it over traditional hosting."
    console.log(`\n👤 User: ${basicPrompt}\n`)
    console.log('🤖 Assistant:')

    const basicResult = await assistant.generate(basicPrompt)
    console.log(basicResult.content)

    console.log(`\n📊 Usage: ${basicResult.usage?.totalTokens} tokens`)
    if (basicResult.usage) {
      // Claude Sonnet 4 pricing: $0.003 per 1K input, $0.015 per 1K output
      const cost = (basicResult.usage.inputTokens / 1000 * 0.003) + (basicResult.usage.outputTokens / 1000 * 0.015)
      console.log(`💰 Estimated cost: $${cost.toFixed(4)}`)
    }

    // ==========================================
    // DEMO 2: Fast Response with Claude Haiku
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(60))
    console.log('DEMO 2: Quick Response with Claude Haiku')
    console.log('=' + '='.repeat(60))

    const quick = agents.get('quick')
    console.log(`🤖 Using: ${quick.getName()}`)

    const quickPrompt = "What are the top 3 programming languages for web development in 2024?"
    console.log(`\n👤 User: ${quickPrompt}\n`)
    console.log('🤖 Assistant: ')

    const quickStreamResult = await quick.streamGenerate(quickPrompt)
    let quickContent = ''

    const startTime = Date.now()
    for await (const chunk of quickStreamResult.textStream) {
      process.stdout.write(chunk)
      quickContent += chunk
    }
    const responseTime = Date.now() - startTime

    const quickFinalResult = await quickStreamResult.getFinalResult()
    console.log(`\n\n⚡ Response time: ${responseTime}ms`)
    console.log(`📊 Usage: ${quickFinalResult.usage?.totalTokens} tokens`)
    if (quickFinalResult.usage) {
      // Claude Haiku pricing: $0.00025 per 1K input, $0.00125 per 1K output
      const cost = (quickFinalResult.usage.inputTokens / 1000 * 0.00025) + (quickFinalResult.usage.outputTokens / 1000 * 0.00125)
      console.log(`💰 Estimated cost: $${cost.toFixed(6)}`)
    }

    // ==========================================
    // DEMO 3: Creative Writing with Higher Temperature
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(60))
    console.log('DEMO 3: Creative Writing with Claude Sonnet')
    console.log('=' + '='.repeat(60))

    const creative = agents.get('creative')
    console.log(`🤖 Using: ${creative.getName()} (temperature: 0.7)`)

    const creativePrompt = "Write a short poem about the relationship between artificial intelligence and human creativity."
    console.log(`\n👤 User: ${creativePrompt}\n`)
    console.log('🤖 Assistant: ')

    const creativeStreamResult = await creative.streamGenerate(creativePrompt)
    let creativeContent = ''

    for await (const chunk of creativeStreamResult.textStream) {
      process.stdout.write(chunk)
      creativeContent += chunk
    }

    const creativeFinalResult = await creativeStreamResult.getFinalResult()
    console.log(`\n\n📊 Usage: ${creativeFinalResult.usage?.totalTokens} tokens`)
    if (creativeFinalResult.usage) {
      const cost = (creativeFinalResult.usage.inputTokens / 1000 * 0.003) + (creativeFinalResult.usage.outputTokens / 1000 * 0.015)
      console.log(`💰 Estimated cost: $${cost.toFixed(4)}`)
    }

    // ==========================================
    // DEMO 4: Model Comparison
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(60))
    console.log('DEMO 4: Model Performance Comparison')
    console.log('=' + '='.repeat(60))

    const comparisonPrompt = "Summarize the key differences between REST and GraphQL APIs."

    console.log(`\n👤 User: ${comparisonPrompt}\n`)

    // Test both models with the same prompt
    console.log('🤖 Claude 3 Haiku (Fast & Cheap):')
    const haikuStart = Date.now()
    const haikuResult = await quick.generate(comparisonPrompt)
    const haikuTime = Date.now() - haikuStart
    console.log(haikuResult.content.substring(0, 200) + '...')

    console.log('\n🤖 Claude Sonnet 4 (Detailed & Thoughtful):')
    const sonnetStart = Date.now()
    const sonnetResult = await assistant.generate(comparisonPrompt)
    const sonnetTime = Date.now() - sonnetStart
    console.log(sonnetResult.content.substring(0, 200) + '...')

    console.log('\n📊 Performance Comparison:')
    console.log(`   Claude 3 Haiku: ${haikuTime}ms, ${haikuResult.usage?.totalTokens} tokens`)
    console.log(`   Claude Sonnet 4: ${sonnetTime}ms, ${sonnetResult.usage?.totalTokens} tokens`)

    // ==========================================
    // SUMMARY
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(60))
    console.log('DEMO COMPLETE - SUMMARY')
    console.log('=' + '='.repeat(60))

    const totalTokens = [
      basicResult.usage?.totalTokens,
      quickFinalResult.usage?.totalTokens,
      creativeFinalResult.usage?.totalTokens,
      haikuResult.usage?.totalTokens,
      sonnetResult.usage?.totalTokens
    ].filter(Boolean).reduce((sum, tokens) => sum + (tokens || 0), 0)

    console.log(`\n📊 Total tokens used across all demos: ${totalTokens}`)
    console.log(`🏭 Factory stats:`, agentFactory.getStats())

    console.log('\n✅ Bedrock AgentFactory Demo Complete!')
    console.log('\n💡 Features demonstrated:')
    console.log('   ✓ Multiple Bedrock models (Claude Sonnet 4, Claude 3 Haiku)')
    console.log('   ✓ Different temperature settings for various use cases')
    console.log('   ✓ Both streaming and non-streaming generation')
    console.log('   ✓ Performance and cost comparison between models')
    console.log('   ✓ Bedrock-specific pricing calculations')
    console.log('   ✓ Type-safe agent factory pattern')

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))

    if (error instanceof Error) {
      if (error.message.includes('credentials')) {
        console.error('💡 Tip: Make sure AWS credentials are properly configured')
      } else if (error.message.includes('region')) {
        console.error('💡 Tip: Ensure the correct AWS region is set for Bedrock')
      } else if (error.message.includes('access')) {
        console.error('💡 Tip: Verify that your AWS account has access to Bedrock models')
      }
    }

    process.exit(1)
  }
}

main().catch(console.error)

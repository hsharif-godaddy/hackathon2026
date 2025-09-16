/**
 * Basic OpenAI Usage Example
 * 
 * Demonstrates simple AI generation using OpenAI GPT models.
 * 
 * Prerequisites:
 * 1. Copy env.example to .env
 * 2. Set OPENAI_API_KEY in your .env file
 * 3. Optionally set OPENAI_BASE_URL for custom endpoints
 */

import 'dotenv/config'
import { Agent } from '../src/index.js'
import { openAIModels, createOpenAIProvider } from '../src/providers/openai.js'

async function main() {
  console.log('🤖 OpenAI Basic Usage Example\n')

  // Check if OpenAI is configured
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found in environment variables')
    console.log('💡 Please copy env.example to .env and set your OpenAI API key')
    process.exit(1)
  }

  try {
    // Create OpenAI provider  
    createOpenAIProvider()
    console.log('✅ OpenAI provider configured')
    
    // Create a simple agent
    const agent = new Agent({
      name: 'Creative Writer',
      systemPrompt: 'You are a creative writing assistant. Help users write engaging stories and content.',
      model: openAIModels.gpt4oMini(),
      temperature: 0.8,
      maxTokens: 500
    })

    console.log(`📝 Agent: ${agent.getConfig().name}`)
    console.log(`🧠 Model: GPT-4o Mini`)
    console.log(`🌡️ Temperature: 0.8\n`)

    // Example 1: Simple story generation
    console.log('📖 Example 1: Story Generation')
    const storyPrompt = "Write a short story about a robot who discovers they can dream."
    
    console.log(`User: ${storyPrompt}`)
    console.log('\nAI:')
    
    const result = await agent.generate(storyPrompt)
    console.log(result.content)
    
    // Show usage stats
    if (result.usage) {
      console.log(`\n📊 Usage: ${result.usage.inputTokens} input + ${result.usage.outputTokens} output = ${result.usage.totalTokens} total tokens`)
    }

    console.log('\n' + '='.repeat(80) + '\n')

    // Example 2: Creative prompt
    console.log('🎨 Example 2: Creative Writing Prompt')
    const creativePrompt = "Give me 3 unique writing prompts for science fiction short stories."
    
    console.log(`User: ${creativePrompt}`)
    console.log('\nAI:')
    
    const result2 = await agent.generate(creativePrompt)
    console.log(result2.content)
    
    if (result2.usage) {
      console.log(`\n📊 Usage: ${result2.usage.inputTokens} input + ${result2.usage.outputTokens} output = ${result2.usage.totalTokens} total tokens`)
    }

    console.log('\n✨ OpenAI example completed successfully!')

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main().catch(console.error)

/**
 * Example: Dynamic Model Selection with AI SDK 6
 *
 * This example demonstrates how to use Call Options to dynamically
 * select models at runtime based on task complexity and cost constraints.
 */

import { createAgentFactory } from '../src/core/agent-factory.js'
import { getModel } from '../src/providers/unified-provider.js'
import type { LanguageModel } from 'ai'

// Define call options interface (would normally be in types.ts)
interface DynamicModelCallOptions {
  /** Override model for this specific call */
  modelName?: string
  /** Task complexity level */
  complexity?: 'low' | 'medium' | 'high'
  /** Cost budget constraint */
  costBudget?: 'low' | 'medium' | 'high'
}

/**
 * Model selection strategy based on task complexity and cost
 */
async function selectModelForTask(
  defaultModel: LanguageModel,
  options: DynamicModelCallOptions
): Promise<LanguageModel> {
  // Direct model override takes precedence
  if (options.modelName) {
    console.log(`[Model Selection] Using explicit override: ${options.modelName}`)
    return await getModel(options.modelName)
  }

  // Complexity-based selection
  if (options.complexity === 'high') {
    console.log('[Model Selection] High complexity -> Using Claude Sonnet 4.5')
    return await getModel('sonnet')
  }

  if (options.complexity === 'low' || options.costBudget === 'low') {
    console.log('[Model Selection] Low complexity/budget -> Using Claude Haiku 4.5')
    return await getModel('haiku')
  }

  // Medium complexity with medium budget
  if (options.complexity === 'medium' && options.costBudget === 'medium') {
    console.log('[Model Selection] Medium complexity/budget -> Using GPT-4o Mini')
    return await getModel('gpt4o-mini')
  }

  console.log('[Model Selection] Using default model')
  return defaultModel
}

/**
 * Example 1: Basic Dynamic Model Selection
 */
async function example1_basicDynamicSelection() {
  console.log('\n=== Example 1: Basic Dynamic Model Selection ===\n')

  const factory = createAgentFactory()

  // Create agent with dynamic model selection
  const agent = factory.createAgent({
    id: 'adaptive-assistant',
    name: 'Adaptive Assistant',
    model: await getModel('gpt4o'), // Default model
    system: 'You are a helpful assistant that adapts to task complexity.',
    maxSteps: 5,

    // Enable dynamic model selection via prepareCall
    prepareCall: async (options) => {
      const callOpts = options.options as DynamicModelCallOptions

      const selectedModel = await selectModelForTask(
        await getModel('gpt4o'),
        callOpts
      )

      return {
        ...options,
        model: selectedModel
      }
    }
  })

  // Example 1a: Simple task with low complexity (uses haiku)
  console.log('Task 1: Simple math question')
  const result1 = await agent.generate('What is 2 + 2?', {
    callOptions: {
      complexity: 'low',
      costBudget: 'low'
    } as DynamicModelCallOptions
  })
  console.log('Response:', result1.content.slice(0, 100))

  // Example 1b: Complex task (uses sonnet)
  console.log('\nTask 2: Complex reasoning')
  const result2 = await agent.generate(
    'Explain the implications of quantum computing on cryptography',
    {
      callOptions: {
        complexity: 'high'
      } as DynamicModelCallOptions
    }
  )
  console.log('Response:', result2.content.slice(0, 100))

  // Example 1c: Explicit model override
  console.log('\nTask 3: Explicit model override')
  const result3 = await agent.generate('Generate a haiku about programming', {
    callOptions: {
      modelName: 'haiku' // Force use of haiku model
    } as DynamicModelCallOptions
  })
  console.log('Response:', result3.content)
}

/**
 * Example 2: Cost-Optimized Agent
 */
async function example2_costOptimizedAgent() {
  console.log('\n=== Example 2: Cost-Optimized Agent ===\n')

  const factory = createAgentFactory()

  const costOptimizedAgent = factory.createAgent({
    id: 'cost-optimized',
    name: 'Cost Optimized Agent',
    model: await getModel('gpt4o'),

    prepareCall: async (options) => {
      const callOpts = options.options as DynamicModelCallOptions

      // Default to cheapest capable model
      let model = await getModel('haiku')

      // Only use expensive models when explicitly needed
      if (callOpts.complexity === 'high') {
        model = await getModel('sonnet')
        console.log('[Cost Optimization] High complexity requires Sonnet')
      } else {
        console.log('[Cost Optimization] Using Haiku for cost savings')
      }

      // Could also adjust temperature for faster/cheaper responses
      const temperature = callOpts.costBudget === 'low' ? 0.3 : 0.7

      return {
        ...options,
        model,
        temperature
      }
    }
  })

  // Use cost-optimized agent for various tasks
  const tasks = [
    { prompt: 'Summarize: The quick brown fox...', complexity: 'low' },
    { prompt: 'Design a microservices architecture', complexity: 'high' },
    { prompt: 'Write a TODO app', complexity: 'medium' }
  ]

  for (const task of tasks) {
    console.log(`\nTask: ${task.prompt}`)
    await costOptimizedAgent.generate(task.prompt, {
      callOptions: {
        complexity: task.complexity as any,
        costBudget: 'low'
      } as DynamicModelCallOptions
    })
  }
}

/**
 * Example 3: A/B Testing with Different Models
 */
async function example3_abTesting() {
  console.log('\n=== Example 3: A/B Testing Different Models ===\n')

  const factory = createAgentFactory()

  const testAgent = factory.createAgent({
    id: 'ab-test-agent',
    name: 'A/B Test Agent',
    model: await getModel('gpt4o')
  })

  const prompt = 'Write a function to calculate fibonacci numbers'

  // Test same prompt with different models
  const models = ['gpt4o', 'sonnet', 'haiku']

  for (const modelName of models) {
    console.log(`\nTesting with model: ${modelName}`)

    const startTime = Date.now()
    const result = await testAgent.generate(prompt, {
      callOptions: {
        modelName
      } as DynamicModelCallOptions
    })
    const duration = Date.now() - startTime

    console.log('Duration:', duration, 'ms')
    console.log('Tokens:', result.usage?.totalTokens || 'N/A')
    console.log('Response preview:', result.content.slice(0, 150))
  }
}

/**
 * Example 4: Streaming with Dynamic Model Selection
 */
async function example4_streamingWithDynamicModels() {
  console.log('\n=== Example 4: Streaming with Dynamic Models ===\n')

  const factory = createAgentFactory()

  const streamingAgent = factory.createAgent({
    id: 'streaming-adaptive',
    name: 'Streaming Adaptive Agent',
    model: await getModel('gpt4o'),

    prepareCall: async (options) => {
      const callOpts = options.options as DynamicModelCallOptions

      return {
        ...options,
        model: await selectModelForTask(await getModel('gpt4o'), callOpts)
      }
    }
  })

  // Stream with cost-optimized model selection
  console.log('Streaming with haiku (low cost)...')
  const stream = await streamingAgent.streamGenerate(
    'Write a short story about a robot',
    {
      callOptions: {
        complexity: 'low',
        costBudget: 'low'
      } as DynamicModelCallOptions
    }
  )

  let fullResponse = ''
  for await (const chunk of stream.textStream) {
    process.stdout.write(chunk)
    fullResponse += chunk
  }

  const finalResult = await stream.getFinalResult()
  console.log('\n\nFinal token usage:', finalResult.usage)
}

/**
 * Example 5: Context-Aware Model Selection
 */
async function example5_contextAwareSelection() {
  console.log('\n=== Example 5: Context-Aware Model Selection ===\n')

  const factory = createAgentFactory()

  // Agent that selects model based on previous conversation context
  const contextAgent = factory.createAgent({
    id: 'context-aware',
    name: 'Context Aware Agent',
    model: await getModel('gpt4o'),

    prepareCall: async (options) => {
      const callOpts = options.options as DynamicModelCallOptions

      // Analyze conversation length to determine model
      const messages = (options as any).messages || []
      const conversationLength = messages.length

      let model: LanguageModel

      if (conversationLength > 10) {
        // Long conversations need better models for context retention
        console.log('[Context] Long conversation -> Using Sonnet')
        model = await getModel('sonnet')
      } else if (callOpts.complexity === 'low') {
        console.log('[Context] Short conversation + low complexity -> Using Haiku')
        model = await getModel('haiku')
      } else {
        console.log('[Context] Default -> Using GPT-4o')
        model = await getModel('gpt4o')
      }

      return {
        ...options,
        model
      }
    }
  })

  // Simulate conversation with increasing context
  const conversation = [
    { role: 'user' as const, content: 'Hello!' },
    { role: 'assistant' as const, content: 'Hi! How can I help?' }
  ]

  for (let i = 0; i < 3; i++) {
    console.log(`\nTurn ${i + 1}:`)
    await contextAgent.generate('Tell me more', {
      messages: conversation,
      callOptions: {
        complexity: i === 0 ? 'low' : 'medium'
      } as DynamicModelCallOptions
    })

    // Add messages to simulate growing conversation
    conversation.push(
      { role: 'user' as const, content: 'Tell me more' },
      { role: 'assistant' as const, content: 'Here is more information...' }
    )
  }
}

/**
 * Run all examples
 */
async function main() {
  console.log('Dynamic Model Selection Examples with AI SDK 6')
  console.log('='.repeat(60))

  try {
    await example1_basicDynamicSelection()
    await example2_costOptimizedAgent()
    await example3_abTesting()
    await example4_streamingWithDynamicModels()
    await example5_contextAwareSelection()

    console.log('\n\nAll examples completed successfully!')
  } catch (error) {
    console.error('\n\nExample failed:', error)
    process.exit(1)
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

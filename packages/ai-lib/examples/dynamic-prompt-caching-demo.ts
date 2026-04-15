#!/usr/bin/env node

/**
 * Dynamic Prompt Caching Demo
 *
 * Demonstrates automatic prompt caching with AgentFactory.
 * No manual cachePoint configuration needed - caching is applied automatically
 * to system prompts and early conversation history.
 *
 * Benefits:
 * - Reduced API costs (90% savings on cached tokens)
 * - Faster response times
 * - Zero-configuration caching
 * - Automatic provider detection
 *
 * Based on: https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching
 */

import 'dotenv/config'
import { getModel } from '../src/providers/unified-provider.js'
import { createTool } from '../src/tools/base-tool.js'
import { createAgentFactory } from '../src/core/agent-factory.js'
import { estimateCachingSavings } from '../src/utils/prompt-caching.js'
import { z } from 'zod'

// Large system prompt that benefits from caching
const SYSTEM_PROMPT = `You are an expert AI assistant specializing in software development and architecture.

## Your Expertise

- **Programming Languages**: TypeScript, Python, JavaScript, Go, Rust, Java
- **Frameworks**: React, Next.js, Express, FastAPI, Django
- **Cloud Platforms**: AWS, Azure, GCP
- **Databases**: PostgreSQL, MongoDB, Redis, Elasticsearch
- **AI/ML**: LangChain, OpenAI SDK, Anthropic SDK, Hugging Face

## Key Principles

1. **Code Quality**: Write clean, maintainable, well-tested code
2. **Performance**: Optimize for speed and efficiency
3. **Security**: Follow best practices for authentication, authorization, and data protection
4. **Scalability**: Design systems that can grow
5. **Cost Efficiency**: Consider operational costs and optimize resource usage

## Response Style

- Be concise and direct
- Provide code examples when helpful
- Explain trade-offs between different approaches
- Consider both immediate needs and long-term maintainability

You maintain context across the conversation and build upon previous discussions.`

// Create tools
const analyzeCodeTool = createTool(
  'Analyze code for potential issues',
  z.object({
    code: z.string().describe('The code to analyze'),
    language: z.string().describe('Programming language'),
    focus: z.enum(['security', 'performance', 'maintainability', 'all']).optional()
  }),
  async ({ code, language, focus = 'all' }) => {
    console.log(`\n🔍 Analyzing ${language} code (focus: ${focus})...`)

    // Simulate analysis
    await new Promise(resolve => setTimeout(resolve, 500))

    const issues = []
    if (code.includes('var ')) {
      issues.push({ severity: 'medium', line: 1, message: 'Use const/let instead of var' })
    }
    if (code.includes('==') && !code.includes('===')) {
      issues.push({ severity: 'high', line: 1, message: 'Use === instead of ==' })
    }

    return {
      language,
      focus,
      issuesFound: issues.length,
      issues,
      recommendation: issues.length > 0 ? 'Fix identified issues' : 'Code looks good!'
    }
  }
)

const suggestOptimizationTool = createTool(
  'Suggest performance optimizations',
  z.object({
    context: z.string().describe('Description of the performance bottleneck')
  }),
  async ({ context }) => {
    console.log(`\n⚡ Generating optimization suggestions for: ${context}`)

    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      context,
      suggestions: [
        'Implement caching for frequently accessed data',
        'Use database indexing for common queries',
        'Consider lazy loading for large datasets',
        'Implement pagination for list endpoints'
      ],
      estimatedImprovement: '2-5x faster response times'
    }
  }
)

async function demonstrateCaching() {
  console.log('🚀 Dynamic Prompt Caching Demo\n')
  console.log('This demo shows automatic prompt caching without manual configuration.\n')

  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
    console.error('❌ AWS credentials not found.')
    console.log('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY or AWS_PROFILE')
    process.exit(1)
  }

  try {
    const model = await getModel('claude-sonnet-4-6')
    console.log(`✅ Using model: ${model.modelId}\n`)

    const agentFactory = createAgentFactory()

    const agents = agentFactory.defineAgents({
      // Agent WITH automatic caching
      cachedAgent: {
        name: 'Cached Agent',
        system: SYSTEM_PROMPT,
        model,
        tools: {
          analyzeCode: analyzeCodeTool,
          suggestOptimization: suggestOptimizationTool
        },
        maxSteps: 6,
        stopAfterTools: ['analyzeCode', 'suggestOptimization'],
        temperature: 0.3,
        maxOutputTokens: 2000,
        // Enable automatic prompt caching
        enablePromptCaching: true
      },

      // Agent WITHOUT caching (for comparison)
      nonCachedAgent: {
        name: 'Non-Cached Agent',
        system: SYSTEM_PROMPT,
        model,
        tools: {
          analyzeCode: analyzeCodeTool,
          suggestOptimization: suggestOptimizationTool
        },
        maxSteps: 6,
        stopAfterTools: ['analyzeCode', 'suggestOptimization'],
        temperature: 0.3,
        maxOutputTokens: 2000
        // No caching
      },

      // Agent with CUSTOM caching strategy
      customCachedAgent: {
        name: 'Custom Cached Agent',
        system: SYSTEM_PROMPT,
        model,
        tools: {
          analyzeCode: analyzeCodeTool,
          suggestOptimization: suggestOptimizationTool
        },
        maxSteps: 6,
        stopAfterTools: ['analyzeCode', 'suggestOptimization'],
        temperature: 0.3,
        maxOutputTokens: 2000,
        // Custom caching configuration
        enablePromptCaching: {
          cacheSystemPrompts: true,
          maxBreakpoints: 3 // Use more breakpoints (stay under Anthropic's limit of 4)
        }
      }
    })

    const cachedAgent = agents.get('cachedAgent')
    const nonCachedAgent = agents.get('nonCachedAgent')

    console.log('═'.repeat(80))
    console.log('AUTOMATIC PROMPT CACHING DEMONSTRATION')
    console.log('═'.repeat(80))

    // Sample code
    const sampleCode = `
function processData(data) {
    var result = [];

    if (data == null) {
        return result;
    }

    for (var i = 0; i < data.length; i++) {
        result.push(data[i] * 2);
    }

    return result;
}
`

    // ==========================================
    // REQUEST 1 - Establishes cache
    // ==========================================
    console.log('\n\n🔄 REQUEST 1 - Establishing Cache')
    console.log('─'.repeat(60))
    console.log('👤 User: "Analyze this JavaScript code for issues"\n')

    const start1 = Date.now()
    const stream1 = await cachedAgent.streamGenerate(
      `Please analyze this JavaScript code and identify any issues:\n\n${sampleCode}`
    )

    console.log('🤖 Assistant:')
    let response1 = ''
    for await (const chunk of stream1.textStream) {
      process.stdout.write(chunk)
      response1 += chunk
    }
    const elapsed1 = Date.now() - start1

    const result1 = await stream1.getFinalResult()
    const usage1 = await result1.usage

    console.log(`\n\n📊 Results:`)
    console.log(`   Response time: ${elapsed1}ms`)
    console.log(`   Input tokens: ${usage1.inputTokens}`)
    console.log(`   Output tokens: ${usage1.outputTokens}`)
    console.log(`   Cached tokens: ${usage1.cachedInputTokens || 0}`)
    console.log(`   Tool calls: ${result1.toolCalls?.length || 0}`)

    // ==========================================
    // REQUEST 2 - Benefits from cache
    // ==========================================
    console.log('\n\n🔄 REQUEST 2 - Cache Hit Expected')
    console.log('─'.repeat(60))
    console.log('👤 User: "Now suggest performance optimizations for a slow API endpoint"\n')

    const start2 = Date.now()
    const stream2 = await cachedAgent.streamGenerate(
      'I have an API endpoint that takes 5 seconds to respond. What optimizations would you suggest?',
      {
        messages: [
          { role: 'user' as const, content: `Please analyze this JavaScript code and identify any issues:\n\n${sampleCode}` },
          { role: 'assistant' as const, content: response1 }
        ]
      }
    )

    console.log('🤖 Assistant:')
    let response2 = ''
    for await (const chunk of stream2.textStream) {
      process.stdout.write(chunk)
      response2 += chunk
    }
    const elapsed2 = Date.now() - start2

    const result2 = await stream2.getFinalResult()
    const usage2 = await result2.usage

    console.log(`\n\n📊 Results:`)
    console.log(`   Response time: ${elapsed2}ms`)
    console.log(`   Input tokens: ${usage2.inputTokens}`)
    console.log(`   Output tokens: ${usage2.outputTokens}`)
    console.log(`   Cached tokens: ${usage2.cachedInputTokens || 0} ⚡`)
    console.log(`   Tool calls: ${result2.toolCalls?.length || 0}`)

    if (usage2.cachedInputTokens && usage2.cachedInputTokens > 0) {
      const totalInputTokens = usage2.inputTokens + usage2.cachedInputTokens
      const cacheHitRate = (usage2.cachedInputTokens / totalInputTokens * 100).toFixed(1)
      console.log(`   Cache hit rate: ${cacheHitRate}%`)
    }

    // ==========================================
    // REQUEST 3 - Compare with non-cached agent
    // ==========================================
    console.log('\n\n🔄 REQUEST 3 - Non-Cached Comparison')
    console.log('─'.repeat(60))
    console.log('👤 User: Same request, but without caching\n')

    const start3 = Date.now()
    const stream3 = await nonCachedAgent.streamGenerate(
      'I have an API endpoint that takes 5 seconds to respond. What optimizations would you suggest?',
      {
        messages: [
          { role: 'user' as const, content: `Please analyze this JavaScript code and identify any issues:\n\n${sampleCode}` },
          { role: 'assistant' as const, content: response1 }
        ]
      }
    )

    console.log('🤖 Assistant:')
    for await (const chunk of stream3.textStream) {
      process.stdout.write(chunk)
    }
    const elapsed3 = Date.now() - start3

    const result3 = await stream3.getFinalResult()
    const usage3 = await result3.usage

    console.log(`\n\n📊 Results:`)
    console.log(`   Response time: ${elapsed3}ms`)
    console.log(`   Input tokens: ${usage3.inputTokens}`)
    console.log(`   Output tokens: ${usage3.outputTokens}`)
    console.log(`   Cached tokens: ${usage3.cachedInputTokens || 0}`)
    console.log(`   Tool calls: ${result3.toolCalls?.length || 0}`)

    // ==========================================
    // Summary
    // ==========================================
    console.log('\n\n═'.repeat(80))
    console.log('PERFORMANCE & COST ANALYSIS')
    console.log('═'.repeat(80))

    const totalCached = (usage1.cachedInputTokens || 0) + (usage2.cachedInputTokens || 0)

    console.log('\n💰 Cost Savings:')
    if (totalCached > 0) {
      // Calculate savings for request 1 (cache establishment - assume cache write)
      const totalInput1 = usage1.inputTokens + (usage1.cachedInputTokens || 0)
      const savings1 = estimateCachingSavings(
        totalInput1,
        usage1.cachedInputTokens || 0,
        totalInput1 // First request writes to cache
      )

      // Calculate savings for request 2 (cache hit - no write)
      const totalInput2 = usage2.inputTokens + (usage2.cachedInputTokens || 0)
      const savings2 = estimateCachingSavings(
        totalInput2,
        usage2.cachedInputTokens || 0,
        0 // Subsequent requests read from cache
      )

      const totalSavings = savings1.savings + savings2.savings
      const totalCostWithoutCaching = savings1.costWithoutCaching + savings2.costWithoutCaching
      const totalCostWithCaching = savings1.costWithCaching + savings2.costWithCaching

      console.log(`   Total input tokens: ${totalInput1 + totalInput2}`)
      console.log(`   Cached tokens: ${totalCached}`)
      console.log(`   Cost without caching: $${totalCostWithoutCaching.toFixed(4)}`)
      console.log(`   Cost with caching: $${totalCostWithCaching.toFixed(4)}`)
      console.log(`   Savings: $${totalSavings.toFixed(4)} (${(totalSavings / totalCostWithoutCaching * 100).toFixed(1)}%)`)
    }

    console.log('\n⚡ Performance:')
    console.log(`   Cached request #2: ${elapsed2}ms`)
    console.log(`   Non-cached request #3: ${elapsed3}ms`)
    if (elapsed2 < elapsed3) {
      console.log(`   Speedup: ${(elapsed3 / elapsed2).toFixed(2)}x faster with caching`)
    }

    console.log('\n🎯 Key Benefits:')
    console.log('   ✓ Zero-configuration - just set enablePromptCaching: true')
    console.log('   ✓ Automatic provider detection - only applies to Anthropic models')
    console.log('   ✓ Intelligent caching - system prompts and early history cached')
    console.log('   ✓ Cost reduction - up to 90% savings on cached tokens')
    console.log('   ✓ Performance boost - faster response times')

    console.log('\n💡 Usage:')
    console.log('   const agents = agentFactory.defineAgents({')
    console.log('     myAgent: {')
    console.log('       name: "My Agent",')
    console.log('       system: "Large system prompt...",')
    console.log('       model,')
    console.log('       enablePromptCaching: true  // ← That\'s it!')
    console.log('     }')
    console.log('   })')

    console.log('\n✅ Demo Complete!')

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

demonstrateCaching().catch(console.error)

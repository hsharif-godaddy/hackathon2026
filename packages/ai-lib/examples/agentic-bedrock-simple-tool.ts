/**
 * Simple Agentic Tool Call Example
 *
 * This example demonstrates basic agentic capabilities:
 * - Tool calls triggered by user prompt
 * - No tool stop conditions
 * - Streaming response with tool integration
 * - Works with Bedrock, Anthropic API, or OpenAI proxy
 * - Streaming now works properly with Anthropic configuration!
 */

import 'dotenv/config'
import { getModel } from '../src/providers/unified-provider.js'
import { createTool } from '../src/tools/base-tool.js'
import { createAgentFactory } from '../src/core/agent-factory.js'
import { z } from 'zod'

// Track tool executions
let toolExecutionCount = 0

// Simple calculator tool
const calculatorTool = createTool(
  'Perform basic mathematical calculations',
  z.object({
    expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2", "10 * 5", "100 / 4")'),
    operation: z.string().describe('Type of operation: addition, subtraction, multiplication, division, or mixed').optional()
  }),
  async ({ expression, operation = 'mixed' }) => {
    toolExecutionCount++
    console.log(`🧮 [Calculator Tool] Evaluating: ${expression}`)

    try {
      // Simple expression evaluator (safe for basic math)
      // First normalize common math symbols
      const normalized = expression
        .replace(/×/g, '*')  // Replace × with *
        .replace(/÷/g, '/')  // Replace ÷ with /
        .replace(/\s+/g, '') // Remove all spaces

      const sanitized = normalized.replace(/[^0-9+\-*/().]/g, '')

      if (!sanitized) {
        throw new Error('No valid mathematical expression found')
      }

      // Evaluate the expression safely
      const result = Function(`"use strict"; return (${sanitized})`)()

      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error('Result is not a valid number')
      }

      const response = {
        expression: expression,
        result: result,
        operation: operation,
        formatted: `${expression} = ${result}`,
        timestamp: new Date().toISOString()
      }

      console.log(`✅ [Calculator Tool] Result: ${response.formatted}`)
      return response

    } catch (error) {
      const errorResponse = {
        expression: expression,
        error: 'Invalid mathematical expression',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }

      console.log(`❌ [Calculator Tool] Error: ${errorResponse.error}`)
      return errorResponse
    }
  }
)

async function runSimpleToolExample() {
  console.log('🚀 Simple Agentic Tool Call Example\n')

  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
    console.error('❌ AWS credentials not found.')
  }

  try {
    console.log('🔗 Connecting to AWS Bedrock...')

    // Debug: Get model info before creating the model
    const { getModelInfo } = await import('../src/providers/unified-provider.js')
    const modelInfo = getModelInfo('claude4')
    console.log('🔍 Model Info:', JSON.stringify(modelInfo, null, 2))

    const model = await getModel('claude4')

    console.log('🏭 Creating calculator agent...')

    const agentFactory = createAgentFactory()

    const agents = agentFactory.defineAgents({
      calculatorAgent: {
        name: 'Math Calculator Agent',
        system: `You are a helpful math calculator assistant. When users ask you to perform calculations, use the calculator tool to evaluate mathematical expressions.

Always use the calculator tool when users provide mathematical expressions or ask for calculations. Provide clear, friendly responses with the results.`,

        model,
        tools: {
          calculator: calculatorTool
        },

        maxSteps: 3,           // Allow a few steps
        // Note: No stopAfterTools - we want the agent to continue after tool use
        temperature: 0.1,      // Low temperature for consistent math responses
        maxOutputTokens: 1000
      }
    })

    const agent = agents.get('calculatorAgent')

    console.log(`✅ Created agent: ${agent.getName()}`)

    // Debug: Log the agent configuration to see if tools are properly set up
    const agentConfig = agent.getConfig()
    console.log('🔍 Agent Config Debug:')
    console.log(`   Model: ${agentConfig.model}`)
    console.log(`   Tools: ${Object.keys(agentConfig.tools || {}).join(', ')}`)
    console.log(`   System prompt length: ${agentConfig.system?.length || 0} chars`)

    // Debug: Check the actual tool object structure
    console.log('🔍 Tool Structure Debug:')
    const tools = agentConfig.tools || {}
    Object.entries(tools).forEach(([name, tool]) => {
      console.log(`   Tool "${name}":`)
      console.log(`     Type: ${typeof tool}`)
      console.log(`     Keys: ${Object.keys(tool as any).join(', ')}`)
      console.log(`     Has execute: ${!!(tool as any).execute}`)
      console.log(`     Has description: ${!!(tool as any).description}`)
      console.log(`     Has parameters: ${!!(tool as any).parameters}`)
      console.log(`     Has inputSchema: ${!!(tool as any).inputSchema}`)
    })

    console.log('\n' + '='.repeat(60))
    console.log('SIMPLE TOOL CALL DEMONSTRATION')
    console.log('='.repeat(60))

    // Reset tool execution counter
    toolExecutionCount = 0

    // Simple user prompt that should trigger exactly one tool call
    const userPrompt = "What is 15 * 7 + 23?"

    console.log(`\n👤 User: ${userPrompt}`)

    const streamResult = await agent.streamGenerate(userPrompt)

    console.log('🤖 Assistant: ')

    let assistantResponse = ''
    for await (const chunk of streamResult.textStream) {
      process.stdout.write(chunk)
      assistantResponse += chunk
    }

    const finalResult = await streamResult.getFinalResult()

    console.log('\n\n' + '='.repeat(60))
    console.log('EXECUTION SUMMARY')
    console.log('='.repeat(60))

    const toolCalls = finalResult.toolCalls || []

    console.log(`\n📊 Results:`)
    console.log(`   Response: ${assistantResponse.substring(0, 100)}${assistantResponse.length > 100 ? '...' : ''}`)
    console.log(`   Tool calls made: ${toolExecutionCount} (actual executions)`)
    console.log(`   Tool calls in result: ${Array.isArray(toolCalls) ? toolCalls.length : 0}`)
    console.log(`   Tokens used: ${finalResult.usage?.totalTokens || 'N/A'}`)
    console.log(`   Finish reason: ${finalResult.finishReason}`)

    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      console.log(`\n🔧 Tool Call Details:`)
      toolCalls.forEach((call, index) => {
        // Handle both stream format and final result format
        const toolName = call.toolName || call.toolCall?.toolName || 'unknown'
        const input = call.input || call.args || call.toolCall?.args || {}
        const output = call.output || call.result || call.toolCall?.result || null

        console.log(`   ${index + 1}. Tool: ${toolName}`)
        console.log(`      Input: ${JSON.stringify(input)}`)
        if (output) {
          console.log(`      Output: ${JSON.stringify(output).substring(0, 200)}`)
        }
      })
    }

    console.log('\n🎯 Features Demonstrated:')
    console.log('   ✓ Tool calls triggered by user prompt')
    console.log('   ✓ No tool stop conditions (agent continues after tool use)')
    console.log('   ✓ Simple request-response flow')
    console.log('   ✓ Basic error handling in tool')
    console.log('   ✓ Streaming response with tool integration')
    console.log('   ✓ Agent-driven tool usage (no human intervention needed)')

    console.log('\n💡 Notes:')
    console.log('   • When agents continue generating text after tool calls,')
    console.log('     the AI SDK may not include tool calls in the final result.')
    console.log('   • This is why we track actual executions separately.')

    if (modelInfo.usingProxy) {
      console.log('\n✅ Using Proxy Configuration:')
      console.log(`   • Provider: ${modelInfo.provider}`)
      console.log(`   • Reason: ${modelInfo.proxyReason}`)
      if (modelInfo.provider === 'anthropic') {
        console.log('   • Streaming and tool calling fully supported!')
      }
    }

    console.log('\n✅ Simple Tool Call Demo Complete!')

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

runSimpleToolExample().catch(console.error)

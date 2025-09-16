/**
 * Streaming Agentic Runner Example
 * 
 * Demonstrates real-time streaming of agentic reasoning with:
 * - Streaming text content as it's generated
 * - Immediate tool call notifications  
 * - Real-time progress updates
 * - Live UI feedback
 */

import 'dotenv/config'
import { Agent, createStreamingAgenticRunner } from '../src/index.js'
import { openAIModels } from '../src/providers/openai.js'
import { createTool } from '../src/tools/base-tool.js'
import { z } from 'zod'

// Create a calculator tool
const calculatorTool = createTool(
  'Perform mathematical calculations',
  z.object({
    expression: z.string().describe('Mathematical expression to evaluate')
  }),
  async ({ expression }) => {
    try {
      const result = Function(`"use strict"; return (${expression})`)()
      return { result: Number(result), expression }
    } catch (error) {
      return { error: 'Invalid expression', expression }
    }
  }
)

async function main() {
  console.log('🚀 Streaming Agentic Runner Example\n')

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found')
    process.exit(1)
  }

  try {
    // Create agent with tools
    const agent = new Agent({
      name: 'Streaming Problem Solver',
      systemPrompt: `You are a helpful assistant that solves problems step by step.
      Use the calculator tool for mathematical operations.
      Always explain your reasoning clearly.`,
      model: openAIModels.gpt4oMini(),
      tools: { calculator: calculatorTool },
      temperature: 0.3
    })

    console.log('🧠 Agent created with streaming capabilities')
    console.log('🔧 Tools: calculator available\n')

    // Create streaming runner
    const streamingRunner = createStreamingAgenticRunner(agent)

    const problem = `Calculate the compound interest on $10,000 invested at 5% annual interest for 3 years, compounded annually. Show your work step by step.`

    console.log(`💭 Problem: ${problem}\n`)
    console.log('📡 Starting streaming agentic loop...\n')

    // Use the streaming generator API
    const stream = streamingRunner.runStreamingLoop(problem, {
      maxSteps: 5,
      onPartialContent: async (chunk, step) => {
        // Stream content in real-time (like typing effect)
        process.stdout.write(chunk)
      },
      onToolCall: async (toolCall, step) => {
        console.log(`\n🔧 Tool Call in Step ${step.stepNumber}:`)
        console.log(`   Tool: ${toolCall.name}`)
        console.log(`   Input: ${JSON.stringify(toolCall.input)}`)
        if (toolCall.result) {
          console.log(`   Result: ${JSON.stringify(toolCall.result)}`)
        }
        console.log() // Add spacing
      },
      onStep: async (step) => {
        console.log(`\n🔄 Step ${step.stepNumber} ${step.isComplete ? 'Complete' : 'Started'}`)
        if (step.isComplete) {
          console.log(`✅ Final content: ${step.partialResult.slice(0, 100)}...`)
          console.log(`🔧 Tool calls in step: ${Array.isArray(step.toolCalls) ? step.toolCalls.length : 'Not an array: ' + typeof step.toolCalls}`)
        }
      }
    })

    let finalResult
    for await (const step of stream) {
      // The callbacks handle the real-time updates
      // This just tracks the final result
      if (step.isComplete && step.isFinal) {
        finalResult = step
      }
    }

    console.log('\n\n✨ Streaming completed!')
    console.log(`🎯 Total steps: ${finalResult?.stepNumber || 'Unknown'}`)
    console.log(`📊 Tool calls: ${Array.isArray(finalResult?.toolCalls) ? finalResult.toolCalls.length : 0}`)

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main().catch(console.error)

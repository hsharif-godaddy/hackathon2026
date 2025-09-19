#!/usr/bin/env tsx

import { createExperimentalAgentFactory, getModel } from '../src/index.js'
import { createTool } from '../src/tools/index.js'
import { z } from 'zod'

/**
 * Demo of tool execution hooks in ExperimentalAgentFactory
 * 
 * This example shows how to implement agent-level hooks similar to the 
 * develop-agent's beforeToolExecution and afterToolExecution methods.
 */

// Create some demo tools
const fileEditTool = createTool(
  'Edit or create files with content',
  z.object({
    filePath: z.string().describe('Path to the file to edit'),
    content: z.string().describe('Content to write to the file'),
    operation: z.enum(['create', 'edit', 'append']).describe('Type of operation')
  }),
  async ({ filePath, content, operation }) => {
    // Simulate file editing
    console.log(`📝 ${operation.toUpperCase()}: ${filePath}`)
    console.log(`Content: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`)
    
    return {
      success: true,
      message: `File ${filePath} ${operation}ed successfully`,
      filePath,
      operation
    }
  }
)

const gitStatusTool = createTool(
  'Check git repository status',
  z.object({
    checkBranch: z.boolean().optional().describe('Whether to check current branch')
  }),
  async ({ checkBranch = true }) => {
    // Simulate git status
    console.log('📊 Checking git status...')
    
    return {
      branch: 'main',
      status: 'clean',
      staged: [],
      modified: [],
      untracked: []
    }
  }
)

const terminalTool = createTool(
  'Execute terminal commands',
  z.object({
    command: z.string().describe('Command to execute'),
    workingDir: z.string().optional().describe('Working directory')
  }),
  async ({ command, workingDir }) => {
    console.log(`💻 Executing: ${command}${workingDir ? ` (in ${workingDir})` : ''}`)
    
    return {
      success: true,
      stdout: `Command executed: ${command}`,
      stderr: '',
      exitCode: 0
    }
  }
)

/**
 * Git branch checking hook (similar to develop-agent)
 */
async function beforeToolExecution(toolName: string, args: unknown): Promise<unknown> {
  console.log(`🔧 [BEFORE] Executing tool: ${toolName}`)
  
  // File-modifying tools that need git branch check
  const fileModifyingTools = ['fileEdit', 'terminal']
  
  if (fileModifyingTools.includes(toolName)) {
    console.log(`⚠️  File-modifying tool detected: ${toolName}`)
    console.log(`🔍 Checking git branch state...`)
    
    // Simulate git branch check
    const currentBranch = 'main' // In real implementation, this would call git
    
    if (currentBranch !== 'main') {
      console.log(`⚠️  Not on main branch (currently on: ${currentBranch})`)
      console.log(`🔄 Would attempt to checkout main branch`)
      // In real implementation, would execute git checkout main
    } else {
      console.log(`✅ Already on main branch`)
    }
  }
  
  // Return args unchanged (could modify them if needed)
  return args
}

/**
 * Tool completion tracking hook
 */
async function afterToolExecution(toolName: string, args: unknown, result: unknown): Promise<unknown> {
  console.log(`✅ [AFTER] Completed tool: ${toolName}`)
  
  // Log tool usage for development tracking
  const resultObj = result as any
  if (resultObj?.success) {
    console.log(`🎯 Tool ${toolName} executed successfully`)
  } else if (resultObj?.error) {
    console.log(`❌ Tool ${toolName} failed: ${resultObj.error}`)
  }
  
  // Could modify result if needed
  return result
}

async function demonstrateToolHooks() {
  console.log('🚀 Tool Execution Hooks Demo\n')

  // Create agent factory with hooks
  const factory = createExperimentalAgentFactory()
  
  const agents = factory.defineAgents({
    developer: {
      name: 'AI Developer with Hooks',
      system: `You are an AI developer assistant with built-in safety checks.

You have access to file editing, git operations, and terminal commands.
Before each file-modifying operation, the system automatically checks that you're on the main git branch for safety.

When a user asks you to edit files or run commands, proceed confidently knowing that the safety checks are handled automatically.`,
      model: await getModel('gpt4o'),
      tools: {
        fileEdit: fileEditTool,
        gitStatus: gitStatusTool,
        terminal: terminalTool
      },
      // Add the tool execution hooks
      beforeToolExecution,
      afterToolExecution
    }
  })

  console.log('🤖 Created developer agent with tool execution hooks')
  console.log('📋 Available tools: fileEdit, gitStatus, terminal')
  console.log('🔒 Safety features: Git branch checking, execution logging\n')

  // Test the agent with different scenarios
  const scenarios = [
    {
      name: 'File editing (triggers git check)',
      prompt: 'Create a new file called "test.txt" with the content "Hello, World!"'
    },
    {
      name: 'Git status check (no git check needed)',
      prompt: 'Check the current git repository status'
    },
    {
      name: 'Terminal command (triggers git check)',
      prompt: 'Run the command "npm install" to install dependencies'
    }
  ]

  for (const scenario of scenarios) {
    console.log(`\n📋 Scenario: ${scenario.name}`)
    console.log(`💬 User: ${scenario.prompt}`)
    console.log('🤖 Agent response:')
    
    try {
      const agent = agents.get('developer')
      const result = await agent.streamGenerate(scenario.prompt)
      
      let response = ''
      for await (const chunk of result.textStream) {
        process.stdout.write(chunk)
        response += chunk
      }
      
      const finalResult = await result.getFinalResult()
      console.log(`\n📊 Tool calls made: ${finalResult.toolCalls?.length || 0}`)
      
    } catch (error) {
      console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`)
    }
    
    console.log('\n' + '='.repeat(60))
  }
}

async function demonstrateHookErrorHandling() {
  console.log('\n🧪 Testing Hook Error Handling\n')

  // Create hooks that might fail
  const flakyBeforeHook = async (toolName: string, args: unknown) => {
    console.log(`🔧 [BEFORE] ${toolName}`)
    
    if (toolName === 'fileEdit') {
      throw new Error('Simulated hook failure')
    }
    
    return args
  }

  const flakyAfterHook = async (toolName: string, args: unknown, result: unknown) => {
    console.log(`✅ [AFTER] ${toolName}`)
    
    if (toolName === 'terminal') {
      throw new Error('Simulated after-hook failure')
    }
    
    return result
  }

  const factory = createExperimentalAgentFactory()
  
  const agents = factory.defineAgents({
    flakyAgent: {
      name: 'Agent with Flaky Hooks',
      system: 'You are a test agent with hooks that might fail.',
      model: await getModel('gpt4o'),
      tools: {
        fileEdit: fileEditTool,
        terminal: terminalTool
      },
      beforeToolExecution: flakyBeforeHook,
      afterToolExecution: flakyAfterHook
    }
  })

  console.log('🤖 Testing error handling in hooks...')
  
  try {
    const agent = agents.get('flakyAgent')
    const result = await agent.streamGenerate('Create a file called "test.txt"')
    
    let response = ''
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk)
      response += chunk
    }
    
    console.log('\n✅ Agent continued working despite hook errors')
    
  } catch (error) {
    console.log(`❌ Agent failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function main() {
  console.log('🎯 ExperimentalAgentFactory Tool Execution Hooks Demo\n')

  try {
    await demonstrateToolHooks()
    await demonstrateHookErrorHandling()
    
    console.log('\n✅ All demos completed successfully!')
    console.log('\n📚 Key Features Demonstrated:')
    console.log('  • Agent-level tool execution hooks')
    console.log('  • Git branch safety checking')
    console.log('  • Tool execution logging')
    console.log('  • Error handling in hooks')
    console.log('  • Hook argument/result modification')
    
  } catch (error) {
    console.error('❌ Demo failed:', error)
    process.exit(1)
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

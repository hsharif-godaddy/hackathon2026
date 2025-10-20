#!/usr/bin/env tsx

import { createAgentFactory, getModel } from '../src/index.js'
import { createTool } from '../src/tools/index.js'
import { z } from 'zod'

/**
 * Develop Agent Hook Implementation Example
 *
 * This example shows how to implement the develop-agent's specific
 * beforeToolExecution and afterToolExecution hooks using the new
 * AgentFactory system.
 */

// Mock git tool for demonstration
const gitTool = createTool(
  'Perform git operations like status, branch, checkout, etc.',
  z.object({
    operation: z.enum(['status', 'branch', 'checkout', 'add', 'commit']).describe('Git operation to perform'),
    branch: z.string().optional().describe('Branch name for checkout operations'),
    message: z.string().optional().describe('Commit message')
  }),
  async ({ operation, branch, message }) => {
    console.log(`🔧 Git ${operation}${branch ? ` ${branch}` : ''}${message ? ` "${message}"` : ''}`)

    switch (operation) {
      case 'status':
        return { success: true, status: 'clean', branch: 'main' }
      case 'branch':
        return { success: true, currentBranch: 'main', branches: ['main', 'develop'] }
      case 'checkout':
        return { success: true, message: `Switched to branch '${branch}'` }
      default:
        return { success: true, message: `${operation} completed` }
    }
  }
)

const fileEditTool = createTool(
  'Edit, create, or rewrite files',
  z.object({
    filePath: z.string().describe('Path to the file'),
    content: z.string().describe('File content'),
    mode: z.enum(['create', 'edit', 'append']).describe('Edit mode')
  }),
  async ({ filePath, content, mode }) => {
    console.log(`📝 ${mode.toUpperCase()}: ${filePath}`)
    return { success: true, filePath, mode, message: `File ${mode}ed successfully` }
  }
)

const terminalTool = createTool(
  'Execute shell commands',
  z.object({
    command: z.string().describe('Command to execute'),
    workingDir: z.string().optional().describe('Working directory')
  }),
  async ({ command, workingDir }) => {
    console.log(`💻 Executing: ${command}${workingDir ? ` (in ${workingDir})` : ''}`)
    return { success: true, stdout: `Output of: ${command}`, stderr: '', exitCode: 0 }
  }
)

/**
 * Develop Agent's beforeToolExecution implementation
 * Includes git branch checking for file-modifying tools
 */
async function developAgentBeforeToolExecution(toolName: string, args: unknown): Promise<unknown> {
  console.log(`🔧 Executing development tool: ${toolName}`)

  // File-modifying tools that need git branch check
  const fileModifyingTools = ['fileEdit', 'git', 'terminal']

  if (fileModifyingTools.includes(toolName)) {
    console.log(`⚠️  File-modifying tool detected: ${toolName}`)

    try {
      // Simulate git branch check (in real implementation, would call actual git)
      console.log(`🔍 Checking git branch state...`)

      // Mock git branch result
      const currentBranch = Math.random() > 0.7 ? 'feature-branch' : 'main'

      if (currentBranch !== 'main') {
        console.log(`⚠️  Before executing ${toolName}: Not on main branch, attempting to return to main`)
        console.log(`🔄 Switching from '${currentBranch}' to 'main'`)

        // In real implementation, would execute:
        // await gitTool.execute({ operation: 'checkout', branch: 'main' })
        console.log(`✅ Successfully switched to main branch`)
      } else {
        console.log(`✅ Already on main branch, proceeding with ${toolName}`)
      }

    } catch (error) {
      console.warn(`⚠️  Error checking git branch state before ${toolName} execution:`, error)
      console.log(`🔄 Continuing with execution despite error`)
    }
  }

  // Return args unchanged (could modify them if needed)
  return args
}

/**
 * Develop Agent's afterToolExecution implementation
 * Includes development progress tracking
 */
async function developAgentAfterToolExecution(
  toolName: string,
  args: unknown,
  result: unknown
): Promise<unknown> {
  console.log(`✅ Completed development action: ${toolName}`)

  const resultObj = result as any

  // Track specific tool results
  if (toolName === 'fileEdit' && resultObj?.success) {
    console.log(`📊 File operation completed: ${resultObj.filePath} (${resultObj.mode})`)
  }

  if (toolName === 'terminal' && resultObj?.success) {
    console.log(`📊 Terminal command completed with exit code: ${resultObj.exitCode}`)
  }

  if (toolName === 'git' && resultObj?.success) {
    console.log(`📊 Git operation completed: ${JSON.stringify(resultObj)}`)
  }

  // Log any errors
  if (!resultObj?.success || resultObj?.error) {
    console.log(`❌ Tool ${toolName} encountered issues:`, resultObj?.error || 'Unknown error')
  }

  // Return result unchanged (could modify it if needed)
  return result
}

/**
 * Database Agent handoff simulation
 * Shows how agent handoffs could work in the new system
 */
async function simulateDatabaseHandoff(params: { userId: string; databaseName: string }) {
  console.log('🔄 Simulating handoff to Database Agent for MySQL setup...')
  console.log(`👤 User ID: ${params.userId}`)
  console.log(`🗄️  Database: ${params.databaseName}`)

  // In real implementation, this would:
  // 1. Create a new agent instance (database agent)
  // 2. Pass context and parameters
  // 3. Execute database setup operations
  // 4. Return results

  return {
    success: true,
    message: 'Database setup completed. Ready for frontend integration.',
    credentials: { host: 'localhost', port: 3306, database: params.databaseName },
    backendPort: 3000
  }
}

async function demonstrateDevelopAgentHooks() {
  console.log('🚀 Develop Agent Hooks Implementation Demo\n')

  const factory = createAgentFactory()

  const agents = factory.defineAgents({
    developer: {
      name: 'AI Developer (with develop-agent hooks)',
      system: `You are an AI developer assistant with built-in safety checks and development tracking.

## Development Guidelines:
- Always write clean, maintainable, and well-documented code
- Use modern web development best practices
- Follow responsive design principles
- Include proper error handling

## Safety Features:
- Automatic git branch checking before file operations
- Development progress tracking
- Tool execution logging

When editing files or running commands, proceed confidently knowing that safety checks are handled automatically.`,
      model: await getModel('gpt4o'),
      tools: {
        fileEdit: fileEditTool,
        git: gitTool,
        terminal: terminalTool
      },
      // Add the develop-agent specific hooks
      beforeToolExecution: developAgentBeforeToolExecution,
      afterToolExecution: developAgentAfterToolExecution
    }
  })

  console.log('🤖 Created AI Developer agent with develop-agent hooks')
  console.log('🔒 Safety features: Git branch checking, progress tracking, execution logging\n')

  // Test scenarios that would trigger the hooks
  const scenarios = [
    {
      name: 'File Creation (triggers git check)',
      prompt: 'Create a new React component file called "Button.tsx" with a basic button component'
    },
    {
      name: 'Git Operations (triggers git check)',
      prompt: 'Check the current git status and then commit any changes'
    },
    {
      name: 'Terminal Commands (triggers git check)',
      prompt: 'Run "npm install react" to add React to the project'
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
      console.log(`\n📊 Tools used: ${finalResult.toolCalls?.length || 0}`)

    } catch (error) {
      console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`)
    }

    console.log('\n' + '='.repeat(60))
  }
}

async function demonstrateAgentHandoff() {
  console.log('\n🔄 Agent Handoff Simulation\n')

  // Simulate the develop-agent's handoffToDatabase method
  console.log('💬 User: "Set up a MySQL database for user management"')
  console.log('🤖 Developer Agent: "I need to hand this off to the Database Agent..."')

  const handoffResult = await simulateDatabaseHandoff({
    userId: 'user123',
    databaseName: 'user_management_db'
  })

  console.log('✅ Database Agent handoff completed successfully')
  console.log('🔗 Backend integration ready for frontend development')
  console.log('📊 Handoff result:', JSON.stringify(handoffResult, null, 2))
}

async function main() {
  console.log('🎯 Develop Agent Hooks Implementation Example\n')

  try {
    await demonstrateDevelopAgentHooks()
    await demonstrateAgentHandoff()

    console.log('\n✅ All demonstrations completed successfully!')
    console.log('\n📚 Key Features Implemented:')
    console.log('  • Git branch safety checking (beforeToolExecution)')
    console.log('  • Development progress tracking (afterToolExecution)')
    console.log('  • Tool execution logging')
    console.log('  • Agent handoff simulation')
    console.log('  • Error handling and recovery')
    console.log('\n🔄 Migration Path:')
    console.log('  1. Convert BaseAgent to AgentFactory')
    console.log('  2. Move beforeToolExecution/afterToolExecution to hooks')
    console.log('  3. Implement agent handoffs via factory methods')
    console.log('  4. Use PromptBuilder for dynamic system prompts')

  } catch (error) {
    console.error('❌ Demo failed:', error)
    process.exit(1)
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

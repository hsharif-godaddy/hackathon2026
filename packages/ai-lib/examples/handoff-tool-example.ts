#!/usr/bin/env tsx

import { 
  createAgentFactory, 
  getModel,
  createHandoffTool,
  createInMemoryHandoffStateManager
} from '../src/index.js'

/**
 * Handoff Tool Example
 * 
 * Demonstrates how to use the handoff tool to allow agents to switch control.
 * This is different from delegation - the handoff tool actually switches which
 * agent is handling the conversation, rather than just calling another agent.
 */

async function basicHandoffToolExample() {
  console.log('📋 Basic Handoff Tool Example\n')

  // Create state manager to track which agent is handling each session
  const stateManager = createInMemoryHandoffStateManager({
    defaultAgentId: 'coordinator',
    enableLogging: true,
    onAgentSwitch: (sessionId, from, to, reason) => {
      console.log(`\n✨ Agent switched for session ${sessionId}`)
      console.log(`   ${from} → ${to}`)
      if (reason) console.log(`   Reason: ${reason}`)
      console.log()
    }
  })

  const factory = createAgentFactory()
  const sessionId = 'demo-session-123'
  
  // Define agents
  const agents = factory.defineAgents({
    coordinator: {
      name: 'Coordinator',
      system: `You are a task coordinator. When you receive requests:
- If it's a coding/development task, use the handoff tool to switch to the "developer" agent
- If it's a design/UI task, use the handoff tool to switch to the "designer" agent
- Explain why you're handing off and what the specialist will help with`,
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'developer', description: 'Development and coding tasks' },
        { agentName: 'designer', description: 'Design and UI/UX tasks' }
      ]
    },
    developer: {
      name: 'Developer',
      system: 'You are a software developer. Help with coding, architecture, and technical implementation.',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'coordinator', description: 'Return to coordinator' }
      ]
    },
    designer: {
      name: 'Designer',
      system: 'You are a UI/UX designer. Help with design, user experience, and visual aesthetics.',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'coordinator', description: 'Return to coordinator' }
      ]
    }
  })

  // Add handoff tool to coordinator with state manager
  const coordinatorAgent = agents.get('coordinator')
  const coordinatorConfig = coordinatorAgent.getConfig()
  coordinatorConfig.tools = {
    ...coordinatorConfig.tools,
    handoff: createHandoffTool({
      agents,
      sourceAgentId: 'coordinator',
      stateManager,
      sessionId
    })
  }

  // Initialize session with coordinator
  stateManager.getOrCreateSession(sessionId, 'coordinator')

  console.log('🔷 Example: Coordinator receives a development request')
  console.log('─'.repeat(60))
  
  const result = await coordinatorAgent.generate(
    'I need to build a REST API for user authentication with JWT tokens. Can you help?'
  )
  
  console.log('📝 Coordinator response:')
  console.log(result.content)
  console.log()
  
  if (result.toolCalls && result.toolCalls.length > 0) {
    console.log('🔧 Tool calls made:')
    result.toolCalls.forEach((call: any) => {
      console.log(`  - ${call.name}:`, call.args)
    })
  }
  
  console.log()
  
  // Show state manager stats
  const stats = stateManager.getStats()
  console.log('📊 State Manager Statistics:')
  console.log(`   Total sessions: ${stats.totalSessions}`)
  console.log(`   Total handoffs: ${stats.totalHandoffs}`)
  console.log()
  
  // Show session history
  const history = stateManager.getSessionHistory(sessionId)
  if (history.length > 0) {
    console.log('📜 Session Handoff History:')
    history.forEach((entry, i) => {
      console.log(`   ${i + 1}. ${entry.fromAgentId} → ${entry.toAgentId}`)
      if (entry.reason) console.log(`      Reason: ${entry.reason}`)
      console.log(`      Time: ${entry.timestamp.toISOString()}`)
    })
    console.log()
  }
  
  // Show current agent
  const currentAgent = stateManager.getCurrentAgent(sessionId)
  console.log(`🎯 Current agent for session: ${currentAgent}`)
  console.log()
  
  console.log('✅ Handoff tool example completed!')
  console.log()
  console.log('💡 In a WebSocket environment, subsequent messages would be')
  console.log(`   handled by the ${currentAgent} agent automatically.`)
  
  // Cleanup
  stateManager.stopCleanup()
}

async function main() {
  try {
    await basicHandoffToolExample()
  } catch (error) {
    console.error('❌ Error running example:', error)
    process.exit(1)
  }
}

main()


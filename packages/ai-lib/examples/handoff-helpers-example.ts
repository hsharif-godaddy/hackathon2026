#!/usr/bin/env tsx

import { 
  createAgentFactory, 
  getModel,
  createHandoffTool,
  createHandoffLogger,
  createHandoffValidator
} from '../src/index.js'

/**
 * Handoff Helpers Example
 * 
 * Demonstrates how to use handoff helpers for agent switching with:
 * 1. Validation of handoff permissions
 * 2. Pre/post handoff hooks
 * 3. State management during handoffs
 * 4. Custom handoff logic
 */

async function basicHandoffExample() {
  console.log('📋 Basic Handoff Helpers Example\n')

  const factory = createAgentFactory()
  
  // Define agents with handoff configurations
  const agents = factory.defineAgents({
    coordinator: {
      name: 'Coordinator',
      system: 'You coordinate tasks',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'developer', description: 'Development tasks' },
        { agentName: 'designer', description: 'Design tasks' }
      ]
    },
    developer: {
      name: 'Developer',
      system: 'You handle development',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'coordinator', description: 'Return to coordinator' }
      ]
    },
    designer: {
      name: 'Designer',
      system: 'You handle design',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'coordinator', description: 'Return to coordinator' }
      ]
    }
  })

  // Create handoff helpers
  const handoff = createHandoffTool(agents)

  // Check available handoff targets
  console.log('Available handoff targets from coordinator:')
  const targets = handoff.getHandoffTargets('coordinator')
  targets.forEach(target => {
    console.log(`  - ${target.agentName}: ${target.description}`)
  })
  console.log()

  // Check if specific handoff is allowed
  console.log('Can handoff from coordinator to developer?', 
    handoff.canHandoffTo('coordinator', 'developer'))
  console.log('Can handoff from coordinator to unknown?', 
    handoff.canHandoffTo('coordinator', 'unknown'))
  console.log()

  // Perform a handoff
  console.log('Switching from coordinator to developer...')
  const developerAgent = await handoff.switchAgent('coordinator', 'developer', {
    reason: 'Need to implement a feature'
  })
  
  if (developerAgent) {
    console.log('✅ Successfully switched to developer agent')
    console.log(`   Agent name: ${developerAgent.getConfig().name}`)
  }
  console.log()
}

async function handoffWithHooksExample() {
  console.log('🪝 Handoff with Lifecycle Hooks Example\n')

  const factory = createAgentFactory()
  
  const agents = factory.defineAgents({
    planner: {
      name: 'Planner',
      system: 'You plan projects',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'executor', description: 'Execute the plan' }
      ]
    },
    executor: {
      name: 'Executor',
      system: 'You execute plans',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: []
    }
  })

  // Create handoff helpers with hooks
  const handoff = createHandoffTool(agents, {
    beforeHandoff: async function validate(context) {
      console.log(`🔍 Before handoff: ${context.sourceAgentId} → ${context.targetAgentId}`)
      console.log(`   Reason: ${context.reason || 'None provided'}`)
      
      // Simulate validation logic
      if (context.targetAgentId === 'executor' && !context.reason) {
        console.log('   ❌ Validation failed: Reason is required for executor handoff')
        return false // Cancel handoff
      }
      
      console.log('   ✅ Validation passed')
      return true
    },
    afterHandoff: async function log(context, success) {
      if (success) {
        console.log(`✅ After handoff: Successfully switched to ${context.targetAgentId}`)
        // Here you might:
        // - Update UI state
        // - Save to database
        // - Send notifications
        // - Update analytics
      } else {
        console.log(`❌ After handoff: Failed to switch to ${context.targetAgentId}`)
      }
    }
  })

  // Try handoff without reason (should fail)
  console.log('Attempting handoff without reason:')
  const result1 = await handoff.switchAgent('planner', 'executor')
  console.log(`Result: ${result1 ? 'Success' : 'Failed'}\n`)

  // Try handoff with reason (should succeed)
  console.log('Attempting handoff with reason:')
  const result2 = await handoff.switchAgent('planner', 'executor', {
    reason: 'Ready to execute the project plan'
  })
  console.log(`Result: ${result2 ? 'Success' : 'Failed'}\n`)
}

async function handoffWithLoggingExample() {
  console.log('📝 Handoff with Logging Example\n')

  const factory = createAgentFactory()
  
  const agents = factory.defineAgents({
    agent1: {
      name: 'Agent 1',
      system: 'First agent',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'agent2', description: 'Switch to agent 2' }
      ]
    },
    agent2: {
      name: 'Agent 2',
      system: 'Second agent',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: []
    }
  })

  // Create logger hooks
  const logger = createHandoffLogger(
    function log(message, data) {
      console.log('[LOG] %s: %s', message, JSON.stringify(data, null, 2))
    }
  )

  // Create handoff helpers with logging
  const handoff = createHandoffTool(agents, {
    beforeHandoff: logger.beforeHandoff,
    afterHandoff: logger.afterHandoff
  })

  // Perform handoff with automatic logging
  await handoff.switchAgent('agent1', 'agent2', {
    reason: 'Testing logging functionality',
    metadata: {
      userId: 'user123',
      sessionId: 'session456'
    }
  })
  console.log()
}

async function customValidationExample() {
  console.log('🔒 Custom Validation Example\n')

  const factory = createAgentFactory()
  
  const agents = factory.defineAgents({
    public: {
      name: 'Public Agent',
      system: 'Public facing agent',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'admin', description: 'Admin tasks' }
      ]
    },
    admin: {
      name: 'Admin Agent',
      system: 'Administrative agent',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: []
    }
  })

  // Simulate user permissions
  const userPermissions = {
    isAdmin: false,
    canAccessAdmin: false
  }

  // Create custom validator
  const validator = createHandoffValidator(function validate(context) {
    if (context.targetAgentId === 'admin') {
      console.log('🔒 Checking admin permissions...')
      if (!userPermissions.isAdmin) {
        console.log('   ❌ Access denied: User is not an admin')
        return false
      }
      console.log('   ✅ Access granted')
    }
    return true
  })

  const handoff = createHandoffTool(agents, {
    beforeHandoff: validator
  })

  // Try to handoff to admin without permissions
  console.log('Attempting handoff to admin without permissions:')
  const result = await handoff.switchAgent('public', 'admin', {
    reason: 'Need admin access'
  })
  console.log(`Result: ${result ? 'Success' : 'Failed'}\n`)

  // Grant permissions and try again
  userPermissions.isAdmin = true
  console.log('Attempting handoff to admin with permissions:')
  const result2 = await handoff.switchAgent('public', 'admin', {
    reason: 'Need admin access'
  })
  console.log(`Result: ${result2 ? 'Success' : 'Failed'}\n`)
}

async function stateManagementExample() {
  console.log('💾 State Management Example\n')

  const factory = createAgentFactory()
  
  const agents = factory.defineAgents({
    agent1: {
      name: 'Agent 1',
      system: 'First agent',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'agent2', description: 'Switch to agent 2' }
      ]
    },
    agent2: {
      name: 'Agent 2',
      system: 'Second agent',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: [
        { agentName: 'agent1', description: 'Switch back to agent 1' }
      ]
    }
  })

  // Application state
  const appState = {
    currentAgentId: 'agent1',
    handoffHistory: [] as Array<{
      from: string
      to: string
      timestamp: string
      reason?: string
    }>
  }

  const handoff = createHandoffTool(agents, {
    beforeHandoff: async function saveState(context) {
      console.log(`💾 Saving state before handoff...`)
      // Save current state to database, localStorage, etc.
      console.log(`   Current agent: ${appState.currentAgentId}`)
      return true
    },
    afterHandoff: async function updateState(context, success) {
      if (success) {
        console.log(`💾 Updating state after handoff...`)
        
        // Update current agent
        appState.currentAgentId = context.targetAgentId
        
        // Record in history
        appState.handoffHistory.push({
          from: context.sourceAgentId,
          to: context.targetAgentId,
          timestamp: context.timestamp,
          reason: context.reason
        })
        
        console.log(`   New agent: ${appState.currentAgentId}`)
        console.log(`   History entries: ${appState.handoffHistory.length}`)
      }
    }
  })

  // Perform multiple handoffs
  console.log('Performing handoff 1:')
  await handoff.switchAgent('agent1', 'agent2', {
    reason: 'Testing state management'
  })
  console.log()

  console.log('Performing handoff 2:')
  await handoff.switchAgent('agent2', 'agent1', {
    reason: 'Returning to agent1'
  })
  console.log()

  // Display final state
  console.log('Final application state:')
  console.log(`  Current agent: ${appState.currentAgentId}`)
  console.log(`  Handoff history:`)
  appState.handoffHistory.forEach((entry, index) => {
    console.log(`    ${index + 1}. ${entry.from} → ${entry.to} (${entry.reason})`)
  })
  console.log()
}

async function main() {
  try {
    await basicHandoffExample()
    //await handoffWithHooksExample()
    //await handoffWithLoggingExample()
    //await customValidationExample()
    //await stateManagementExample()
    
    console.log('✅ All handoff helper examples completed successfully!')
  } catch (error) {
    console.error('❌ Error running examples:', error)
    process.exit(1)
  }
}

main()


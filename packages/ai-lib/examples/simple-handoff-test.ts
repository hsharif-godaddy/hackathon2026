#!/usr/bin/env tsx

import { 
  createExperimentalAgentFactory, 
  getModel,
  addHandoffTools
} from '../src/index.js'

/**
 * Simple handoff test to debug the system
 */

async function testBasicHandoff() {
  console.log('🧪 Simple Handoff Test\n')

  const factory = createExperimentalAgentFactory()
  
  const agents = factory.defineAgents({
    coordinator: {
      name: 'Coordinator',
      system: `You are a task coordinator. When asked to delegate work, use the handoff tool to pass tasks to the "worker" agent.`,
      model: await getModel('gpt4o'),
      tools: {
        ...addHandoffTools(factory, 'coordinator')
      },
      handoffs: [
        { agentName: 'worker', description: 'Execute specific tasks' }
      ]
    },

    worker: {
      name: 'Worker',
      system: `You are a task worker. Execute the tasks given to you and provide clear results.`,
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: []
    }
  })

  console.log('🤖 Created simple two-agent system')
  console.log('📋 Testing handoff from coordinator to worker...\n')

  try {
    // Test direct handoff execution
    console.log('🔧 Testing direct handoff execution...')
    
    const handoffResult = await factory.executeHandoff(
      'coordinator',
      'worker', 
      {
        task: 'Say hello and confirm you received this task',
        context: { testData: 'This is a test handoff' },
        metadata: {
          sourceAgent: 'coordinator',
          timestamp: new Date().toISOString(),
          reason: 'Testing handoff system'
        }
      }
    )

    console.log('✅ Direct handoff result:', JSON.stringify(handoffResult, null, 2))

    // Test handoff history
    console.log('\n📋 Handoff History:')
    const history = factory.getHandoffHistory()
    console.log(`Total handoffs: ${history.length}`)
    
    if (history.length > 0) {
      history.forEach((entry, index) => {
        console.log(`${index + 1}. ${entry.sourceAgent} → ${entry.targetAgent}`)
        console.log(`   Status: ${entry.status}`)
        console.log(`   Task: ${entry.task}`)
      })
    }

  } catch (error) {
    console.error('❌ Test failed:', error)
  }
}

async function testAgentToolHandoff() {
  console.log('\n🔧 Testing Agent Tool Handoff\n')

  const factory = createExperimentalAgentFactory()
  
  const agents = factory.defineAgents({
    coordinator: {
      name: 'Coordinator',
      system: `You are a task coordinator. You have access to a handoff tool. 
      
When asked to delegate work, use the handoff tool to pass tasks to the "worker" agent.
Use the exact agent ID "worker" (not "Worker" or any other variation).`,
      model: await getModel('gpt4o'),
      tools: {
        ...addHandoffTools(factory, 'coordinator')
      },
      handoffs: [
        { agentName: 'worker', description: 'Execute specific tasks' }
      ]
    },

    worker: {
      name: 'Worker',
      system: `You are a task worker. Execute the tasks given to you and provide clear results.`,
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: []
    }
  })

  console.log('🤖 Testing handoff via agent tool...')

  try {
    const coordinator = agents.get('coordinator')
    
    console.log('💬 Request: "Please delegate the task of saying hello to the worker agent"')
    console.log('🤖 Coordinator response:')
    
    const result = await coordinator.streamGenerate(
      'Please delegate the task of saying hello to the worker agent using the handoff tool'
    )
    
    let response = ''
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk)
      response += chunk
    }
    
    const finalResult = await result.getFinalResult()
    console.log(`\n\n📊 Tools used: ${finalResult.toolCalls?.length || 0}`)
    
    // Check handoff history
    console.log('\n📋 Handoff History:')
    const history = factory.getHandoffHistory()
    console.log(`Total handoffs: ${history.length}`)
    
  } catch (error) {
    console.error('❌ Agent tool test failed:', error)
  }
}

async function main() {
  console.log('🎯 Simple Handoff System Test\n')

  try {
    await testBasicHandoff()
    await testAgentToolHandoff()
    
    console.log('\n✅ All tests completed!')
    
  } catch (error) {
    console.error('❌ Test suite failed:', error)
    process.exit(1)
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

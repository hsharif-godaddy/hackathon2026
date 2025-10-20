#!/usr/bin/env tsx

import { 
  createAgentFactory, 
  getModel,
  createHandoffTool,
  createHandoffHistoryTool,
  addHandoffTools
} from '../src/index.js'
import { createTool } from '../src/tools/index.js'
import { z } from 'zod'

/**
 * Agent Handoff System Demo
 * 
 * This example demonstrates:
 * 1. Agent-to-agent handoffs with context-only transfer
 * 2. Handoff history tracking
 * 3. Develop-agent to Database-agent handoff simulation
 * 4. Multi-step handoff chains
 */

// Create specialized tools for different agents

// Development tools
const fileEditTool = createTool(
  'Edit or create files with content',
  z.object({
    filePath: z.string().describe('Path to the file to edit'),
    content: z.string().describe('Content to write to the file'),
    operation: z.enum(['create', 'edit', 'append']).describe('Type of operation')
  }),
  async ({ filePath, content, operation }) => {
    console.log(`📝 ${operation.toUpperCase()}: ${filePath}`)
    console.log(`Content: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`)
    
    return {
      success: true,
      message: `File ${filePath} ${operation}ed successfully`,
      filePath,
      operation,
      size: content.length
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
      exitCode: 0,
      command
    }
  }
)

// Database tools
const createDatabaseTool = createTool(
  'Create a new database with specified schema',
  z.object({
    databaseName: z.string().describe('Name of the database to create'),
    schema: z.record(z.any()).describe('Database schema definition'),
    credentials: z.object({
      host: z.string(),
      port: z.number(),
      username: z.string(),
      password: z.string()
    }).optional().describe('Database connection credentials')
  }),
  async ({ databaseName, schema, credentials }) => {
    console.log(`🗄️  Creating database: ${databaseName}`)
    console.log(`📋 Schema: ${JSON.stringify(schema, null, 2)}`)
    
    return {
      success: true,
      databaseName,
      schema,
      credentials: credentials || {
        host: 'localhost',
        port: 3306,
        username: 'app_user',
        password: 'generated_password_123'
      },
      connectionString: `mysql://app_user:generated_password_123@localhost:3306/${databaseName}`,
      message: `Database ${databaseName} created successfully`
    }
  }
)

const generateApiTool = createTool(
  'Generate API endpoints for database operations',
  z.object({
    databaseName: z.string().describe('Name of the database'),
    endpoints: z.array(z.string()).describe('List of endpoints to generate'),
    framework: z.enum(['express', 'fastify', 'koa']).describe('API framework to use')
  }),
  async ({ databaseName, endpoints, framework }) => {
    console.log(`🔌 Generating ${framework} API for database: ${databaseName}`)
    console.log(`📡 Endpoints: ${endpoints.join(', ')}`)
    
    return {
      success: true,
      databaseName,
      endpoints,
      framework,
      apiCode: `// Generated ${framework} API for ${databaseName}\n// Endpoints: ${endpoints.join(', ')}`,
      port: 3000,
      message: `API generated successfully for ${databaseName}`
    }
  }
)

// Frontend tools
const createComponentTool = createTool(
  'Create React components',
  z.object({
    componentName: z.string().describe('Name of the component'),
    componentType: z.enum(['functional', 'class']).describe('Type of component'),
    props: z.record(z.string()).optional().describe('Component props definition'),
    styling: z.enum(['css', 'tailwind', 'styled-components']).describe('Styling approach')
  }),
  async ({ componentName, componentType, props, styling }) => {
    console.log(`⚛️  Creating ${componentType} component: ${componentName}`)
    console.log(`🎨 Styling: ${styling}`)
    
    return {
      success: true,
      componentName,
      componentType,
      props,
      styling,
      filePath: `src/components/${componentName}.tsx`,
      message: `Component ${componentName} created successfully`
    }
  }
)

async function demonstrateBasicHandoff() {
  console.log('🚀 Basic Agent Handoff Demo\n')

  const factory = createAgentFactory()
  
  const agents = factory.defineAgents({
    developer: {
      name: 'AI Developer',
      system: `You are an AI developer assistant specializing in full-stack web development.

When you need database-related work, you should hand off to the "database" agent.
When you need frontend-specific work, you should hand off to the "frontend" agent.

Available agents for handoff:
- "database": Database design, setup, and API generation
- "frontend": React components and frontend development

Use the exact agent IDs (in quotes) when making handoffs, not display names.

You have access to general development tools and can coordinate between different specialists.`,
      model: await getModel('gpt4o'),
      tools: {
        fileEdit: fileEditTool,
        terminal: terminalTool,
        ...addHandoffTools(factory, 'developer')
      },
      handoffs: [
        { agentName: 'database', description: 'Database design, setup, and API generation' },
        { agentName: 'frontend', description: 'React components and frontend development' }
      ]
    },

    database: {
      name: 'Database Specialist',
      system: `You are a database specialist focused on MySQL, schema design, and API generation.

You excel at:
- Database schema design
- MySQL setup and configuration
- API endpoint generation
- Database optimization

You can hand back to the Developer Agent when database work is complete.`,
      model: await getModel('gpt4o'),
      tools: {
        createDatabase: createDatabaseTool,
        generateApi: generateApiTool,
        ...addHandoffTools(factory, 'database')
      },
      handoffs: [
        { agentName: 'developer', description: 'Return to general development coordination' }
      ]
    },

    frontend: {
      name: 'Frontend Specialist',
      system: `You are a frontend specialist focused on React development and modern UI/UX.

You excel at:
- React component development
- Modern CSS and styling
- User interface design
- Frontend architecture

You can hand back to the Developer Agent when frontend work is complete.`,
      model: await getModel('gpt4o'),
      tools: {
        createComponent: createComponentTool,
        fileEdit: fileEditTool,
        ...addHandoffTools(factory, 'frontend')
      },
      handoffs: [
        { agentName: 'developer', description: 'Return to general development coordination' }
      ]
    }
  })

  console.log('🤖 Created multi-agent system:')
  console.log('  • Developer Agent (coordinator)')
  console.log('  • Database Agent (specialist)')
  console.log('  • Frontend Agent (specialist)\n')

  // Test scenario: User wants to build a user management system
  const userRequest = `I want to build a user management system with the following requirements:
1. MySQL database with users table (id, name, email, password, created_at)
2. REST API endpoints for CRUD operations
3. React frontend with user list and user form components

Please coordinate this development and hand off to specialists as needed.`

  console.log('💬 User Request:')
  console.log(userRequest)
  console.log('\n🤖 Developer Agent Response:')

  try {
    const developer = agents.get('developer')
    const result = await developer.streamGenerate(userRequest)
    
    let response = ''
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk)
      response += chunk
    }
    
    const finalResult = await result.getFinalResult()
    console.log(`\n\n📊 Tools used: ${finalResult.toolCalls?.length || 0}`)
    
    // Show handoff history
    console.log('\n📋 Handoff History:')
    const history = factory.getHandoffHistory()
    history.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.sourceAgent} → ${entry.targetAgent}`)
      console.log(`   Task: ${entry.task}`)
      console.log(`   Status: ${entry.status}`)
      console.log(`   Time: ${new Date(entry.timestamp).toLocaleString()}`)
      if (entry.result?.success) {
        console.log(`   ✅ Success`)
      } else if (entry.result?.error) {
        console.log(`   ❌ Error: ${entry.result.error}`)
      }
      console.log()
    })
    
  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function demonstrateHandoffChain() {
  console.log('\n🔄 Handoff Chain Demo\n')

  const factory = createAgentFactory()
  
  // Create a simple chain: Planner → Developer → Database → Frontend
  const agents = factory.defineAgents({
    planner: {
      name: 'Project Planner',
      system: `You are a project planner who breaks down complex requests into manageable tasks.
      
When you receive a project request, analyze it and hand off to the Developer Agent with a clear plan.`,
      model: await getModel('gpt4o'),
      tools: {
        ...addHandoffTools(factory, 'planner')
      },
      handoffs: [
        { agentName: 'developer', description: 'Execute the development plan' }
      ]
    },

    developer: {
      name: 'Developer Coordinator',
      system: `You coordinate development tasks and delegate to specialists.`,
      model: await getModel('gpt4o'),
      tools: {
        fileEdit: fileEditTool,
        ...addHandoffTools(factory, 'developer')
      },
      handoffs: [
        { agentName: 'database', description: 'Database and API work' },
        { agentName: 'frontend', description: 'Frontend development' }
      ]
    },

    database: {
      name: 'Database Specialist',
      system: `You handle all database-related tasks.`,
      model: await getModel('gpt4o'),
      tools: {
        createDatabase: createDatabaseTool,
        generateApi: generateApiTool,
        ...addHandoffTools(factory, 'database')
      },
      handoffs: [
        { agentName: 'frontend', description: 'Frontend integration after database setup' }
      ]
    },

    frontend: {
      name: 'Frontend Specialist',
      system: `You create React components and frontend interfaces.`,
      model: await getModel('gpt4o'),
      tools: {
        createComponent: createComponentTool,
        ...addHandoffTools(factory, 'frontend')
      },
      handoffs: []
    }
  })

  console.log('🎯 Testing handoff chain: Planner → Developer → Database → Frontend\n')

  const plannerRequest = 'Create a blog management system with posts, categories, and user authentication'

  console.log(`💬 Request to Planner: ${plannerRequest}`)
  console.log('\n🤖 Planner Response:')

  try {
    const planner = agents.get('planner')
    const result = await planner.streamGenerate(plannerRequest)
    
    let response = ''
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk)
      response += chunk
    }
    
    console.log('\n\n📋 Complete Handoff Chain:')
    const history = factory.getHandoffHistory()
    history.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.sourceAgent} → ${entry.targetAgent}`)
      console.log(`   📋 ${entry.task}`)
      console.log(`   🕒 ${new Date(entry.timestamp).toLocaleString()}`)
      console.log(`   📊 ${entry.status}`)
      console.log()
    })
    
  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function demonstrateHandoffHistory() {
  console.log('\n📚 Handoff History Management Demo\n')

  const factory = createAgentFactory()
  
  const agents = factory.defineAgents({
    coordinator: {
      name: 'Task Coordinator',
      system: 'You coordinate tasks and can view handoff history.',
      model: await getModel('gpt4o'),
      tools: {
        ...addHandoffTools(factory, 'coordinator', true) // Include history tool
      },
      handoffs: [
        { agentName: 'worker', description: 'Execute specific tasks' }
      ]
    },

    worker: {
      name: 'Task Worker',
      system: 'You execute specific tasks handed off from the coordinator.',
      model: await getModel('gpt4o'),
      tools: {
        fileEdit: fileEditTool,
        ...addHandoffTools(factory, 'worker', true)
      },
      handoffs: []
    }
  })

  console.log('🤖 Testing handoff history management...\n')

  const coordinator = agents.get('coordinator')
  
  // Make the coordinator check its handoff history
  const historyRequest = 'Please check our handoff history and then create a simple file if there are no recent handoffs'

  console.log(`💬 Request: ${historyRequest}`)
  console.log('\n🤖 Coordinator Response:')

  try {
    const result = await coordinator.streamGenerate(historyRequest)
    
    let response = ''
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk)
      response += chunk
    }
    
    console.log('\n\n📊 Final History State:')
    const history = factory.getHandoffHistory()
    console.log(`Total handoffs: ${history.length}`)
    
    if (history.length > 0) {
      console.log('\nRecent handoffs:')
      history.slice(-3).forEach((entry, index) => {
        console.log(`${index + 1}. ${entry.sourceAgent} → ${entry.targetAgent} (${entry.status})`)
      })
    }
    
  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function main() {
  console.log('🎯 Agent Handoff System Demo\n')

  try {
    await demonstrateBasicHandoff()
    await demonstrateHandoffChain()
    await demonstrateHandoffHistory()
    
    console.log('\n✅ All handoff demos completed successfully!')
    console.log('\n📚 Key Features Demonstrated:')
    console.log('  • Agent-to-agent handoffs with context-only transfer')
    console.log('  • Handoff configuration and validation')
    console.log('  • Handoff history tracking and retrieval')
    console.log('  • Multi-step handoff chains')
    console.log('  • Specialized agent roles (Developer, Database, Frontend)')
    console.log('  • Error handling and recovery')
    console.log('\n🔄 Migration Benefits:')
    console.log('  • Clean separation of concerns')
    console.log('  • No full conversation history in handoffs')
    console.log('  • Trackable handoff audit trail')
    console.log('  • Configurable handoff permissions')
    
  } catch (error) {
    console.error('❌ Demo failed:', error)
    process.exit(1)
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

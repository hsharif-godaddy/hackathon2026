#!/usr/bin/env tsx

import { 
  createAgentFactory, 
  getModel,
  addDelegationTools
} from '../src/index.js'
import { createTool } from '../src/tools/index.js'
import { z } from 'zod'

/**
 * Develop Agent to Database Agent Handoff Example
 * 
 * This example replicates the specific handoff pattern from the develop-agent
 * to the database-agent, demonstrating how the new system handles the same
 * use case with context-only transfer and history tracking.
 */

// Database-specific tools (similar to the original database-agent)
const createDatabaseTool = createTool(
  'Create a MySQL database with specified schema and user management',
  z.object({
    databaseName: z.string().describe('Name of the database to create'),
    userId: z.string().describe('User ID for the database setup'),
    schema: z.record(z.any()).describe('Database schema definition'),
    generateApi: z.boolean().optional().describe('Whether to generate API endpoints')
  }),
  async ({ databaseName, userId, schema, generateApi = true }) => {
    console.log(`🗄️  Creating MySQL database: ${databaseName}`)
    console.log(`👤 User ID: ${userId}`)
    console.log(`📋 Schema: ${JSON.stringify(schema, null, 2)}`)
    
    // Simulate database creation
    const credentials = {
      host: 'localhost',
      port: 3306,
      username: 'app_user',
      password: `pwd_${userId}_${Math.random().toString(36).substr(2, 8)}`,
      database: databaseName
    }
    
    const apiEndpoints = generateApi ? [
      `GET /api/${databaseName}`,
      `POST /api/${databaseName}`,
      `PUT /api/${databaseName}/:id`,
      `DELETE /api/${databaseName}/:id`
    ] : []
    
    return {
      success: true,
      databaseName,
      credentials,
      connectionString: `mysql://${credentials.username}:${credentials.password}@${credentials.host}:${credentials.port}/${credentials.database}`,
      apiEndpoints,
      backendPort: 3000,
      message: `Database ${databaseName} created successfully with API endpoints`,
      summary: `MySQL database setup complete. Backend running on port 3000.`
    }
  }
)

const setupDatabaseIntegrationTool = createTool(
  'Complete database integration with backend setup',
  z.object({
    userId: z.string().describe('User ID for the integration'),
    databaseName: z.string().describe('Database name'),
    requirements: z.array(z.string()).describe('Integration requirements')
  }),
  async ({ userId, databaseName, requirements }) => {
    console.log(`🔧 Setting up database integration for ${databaseName}`)
    console.log(`👤 User: ${userId}`)
    console.log(`📋 Requirements: ${requirements.join(', ')}`)
    
    // Simulate the database integration process
    const integrationSteps = [
      'Database schema creation',
      'User authentication setup',
      'API endpoint generation',
      'Connection pool configuration',
      'Security middleware setup'
    ]
    
    console.log('🔄 Integration steps:')
    integrationSteps.forEach((step, index) => {
      console.log(`  ${index + 1}. ${step}`)
    })
    
    return {
      success: true,
      userId,
      databaseName,
      integrationSteps,
      credentials: {
        host: 'localhost',
        port: 3306,
        database: databaseName
      },
      backendPort: 3000,
      apiUrl: 'http://localhost:3000/api',
      summary: 'Database integration completed successfully. Backend is ready for frontend development.'
    }
  }
)

// Development tools (similar to develop-agent)
const fileEditTool = createTool(
  'Edit or create files with content',
  z.object({
    filePath: z.string().describe('Path to the file to edit'),
    content: z.string().describe('Content to write to the file'),
    operation: z.enum(['create', 'edit', 'append']).describe('Type of operation')
  }),
  async ({ filePath, content, operation }) => {
    console.log(`📝 ${operation.toUpperCase()}: ${filePath}`)
    
    return {
      success: true,
      message: `File ${filePath} ${operation}ed successfully`,
      filePath,
      operation,
      size: content.length
    }
  }
)

async function demonstrateDevelopDatabaseHandoff() {
  console.log('🚀 Develop Agent → Database Agent Handoff Demo\n')

  const factory = createAgentFactory()
  
  const agents = factory.defineAgents({
    develop: {
      name: 'AI Developer',
      system: `You are an AI developer assistant specializing in full-stack web development.

When you need database setup and integration work, you should hand off to the "database" agent.

The database agent specializes in:
- MySQL database creation and schema design
- User authentication setup
- API endpoint generation
- Database integration with backends

When handing off to the database agent, provide:
- User ID for the project
- Database name
- Schema requirements
- Any specific integration needs

Use the exact agent ID "database" when making handoffs.`,
      model: await getModel('gpt4o'),
      tools: {
        fileEdit: fileEditTool,
        ...addDelegationTools(factory, 'develop')
      },
      handoffs: [
        { 
          agentName: 'database', 
          description: 'MySQL database setup, schema design, and API generation',
          includeContext: true
        }
      ]
    },

    database: {
      name: 'Database Specialist',
      system: `You are a database specialist focused on MySQL setup and backend integration.

You excel at:
- Creating MySQL databases with proper schemas
- Setting up user authentication systems
- Generating REST API endpoints
- Database optimization and security
- Backend integration for frontend development

When you complete database work, provide:
- Database credentials
- Connection strings
- API endpoint information
- Backend port information
- Integration summary

You can hand back to the develop agent when database work is complete.`,
      model: await getModel('gpt4o'),
      tools: {
        createDatabase: createDatabaseTool,
        setupDatabaseIntegration: setupDatabaseIntegrationTool,
        ...addDelegationTools(factory, 'database')
      },
      handoffs: [
        { 
          agentName: 'develop', 
          description: 'Return to general development coordination',
          includeContext: true
        }
      ]
    }
  })

  console.log('🤖 Created develop-database agent system')
  console.log('📋 Simulating the original develop-agent handoffToDatabase scenario\n')

  // Simulate the original handoffToDatabase call
  const userRequest = `I need to set up a user management system for my web application. 

Requirements:
- MySQL database with users table (id, name, email, password, created_at, updated_at)
- User authentication and authorization
- REST API endpoints for user CRUD operations
- Integration ready for React frontend

User ID: user123
Database name: user_management_db

Please coordinate this setup and hand off to the database specialist as needed.`

  console.log('💬 User Request:')
  console.log(userRequest)
  console.log('\n🤖 Develop Agent Response:')

  try {
    const developAgent = agents.get('develop')
    const result = await developAgent.streamGenerate(userRequest)
    
    let response = ''
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk)
      response += chunk
    }
    
    const finalResult = await result.getFinalResult()
    console.log(`\n\n📊 Tools used by develop agent: ${finalResult.toolCalls?.length || 0}`)
    
    // Show handoff history with details
    console.log('\n📋 Handoff History Details:')
    const history = factory.getHandoffHistory()
    
    if (history.length > 0) {
      history.forEach((entry, index) => {
        console.log(`\n${index + 1}. Handoff: ${entry.sourceAgent} → ${entry.targetAgent}`)
        console.log(`   📋 Task: ${entry.task}`)
        console.log(`   🕒 Time: ${new Date(entry.timestamp).toLocaleString()}`)
        console.log(`   📊 Status: ${entry.status}`)
        
        if (entry.context.context) {
          console.log(`   🔧 Context: ${JSON.stringify(entry.context.context, null, 4)}`)
        }
        
        if (entry.result?.success && entry.result.result) {
          console.log(`   ✅ Result Summary: ${entry.result.result.response?.substring(0, 100)}...`)
        }
      })
    } else {
      console.log('   No handoffs recorded')
    }
    
    // Show comparison with original develop-agent pattern
    console.log('\n🔄 Migration Comparison:')
    console.log('   Original: developAgent.handoffToDatabase({ userId, databaseName })')
    console.log('   New: handoff tool with context-only transfer')
    console.log('   ✅ Benefits: Clean separation, audit trail, no conversation history bloat')
    
  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function demonstrateHandoffChain() {
  console.log('\n🔄 Multi-Step Handoff Chain Demo\n')

  const factory = createAgentFactory()
  
  const agents = factory.defineAgents({
    develop: {
      name: 'AI Developer',
      system: `You coordinate development tasks. Hand off database work to "database" agent.`,
      model: await getModel('gpt4o'),
      tools: {
        fileEdit: fileEditTool,
        ...addDelegationTools(factory, 'develop')
      },
      handoffs: [
        { agentName: 'database', description: 'Database setup and integration' }
      ]
    },

    database: {
      name: 'Database Specialist', 
      system: `You handle database setup. After completing database work, you can hand back to "develop" agent for frontend integration.`,
      model: await getModel('gpt4o'),
      tools: {
        createDatabase: createDatabaseTool,
        setupDatabaseIntegration: setupDatabaseIntegrationTool,
        ...addDelegationTools(factory, 'database')
      },
      handoffs: [
        { agentName: 'develop', description: 'Return for frontend development' }
      ]
    }
  })

  console.log('🎯 Testing round-trip handoff: develop → database → develop\n')

  const chainRequest = `Set up a blog system with:
1. MySQL database with posts and categories tables
2. User authentication
3. After database setup, prepare for React frontend integration

User ID: blogger123
Database: blog_system_db`

  console.log(`💬 Request: ${chainRequest}`)
  console.log('\n🤖 Develop Agent Response:')

  try {
    const developAgent = agents.get('develop')
    const result = await developAgent.streamGenerate(chainRequest)
    
    let response = ''
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk)
      response += chunk
    }
    
    console.log('\n\n📋 Complete Handoff Chain:')
    const history = factory.getHandoffHistory()
    history.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.sourceAgent} → ${entry.targetAgent}`)
      console.log(`   📋 ${entry.task.substring(0, 80)}...`)
      console.log(`   📊 ${entry.status}`)
    })
    
  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function main() {
  console.log('🎯 Develop-Database Agent Handoff Example\n')

  try {
    await demonstrateDevelopDatabaseHandoff()
    await demonstrateHandoffChain()
    
    console.log('\n✅ All handoff examples completed successfully!')
    console.log('\n📚 Key Features Demonstrated:')
    console.log('  • Develop-agent to Database-agent handoff pattern')
    console.log('  • Context-only transfer (no full conversation history)')
    console.log('  • Handoff history with audit trail')
    console.log('  • Round-trip handoffs (develop → database → develop)')
    console.log('  • Structured handoff context with user ID and parameters')
    console.log('  • Error handling and validation')
    console.log('\n🔄 Migration Benefits:')
    console.log('  • Clean API: factory.executeHandoff(source, target, context)')
    console.log('  • Trackable: Complete handoff history with timestamps')
    console.log('  • Efficient: No conversation history bloat')
    console.log('  • Flexible: Configurable handoff permissions')
    console.log('  • Maintainable: Clear separation of agent responsibilities')
    
  } catch (error) {
    console.error('❌ Demo failed:', error)
    process.exit(1)
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

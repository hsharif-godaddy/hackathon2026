import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { AutoAPIGenerator, AutoAPIGeneratorOptions } from '../auto-api-generator.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

// Initialize tool instances
const autoAPIGenerator = new AutoAPIGenerator()
const appRepo = new AppRepository()

/**
 * Auto API Generator Tool for AI-Lib
 * Automatically generate Hono.js API endpoints from database schemas
 */
export const autoAPIGeneratorAITool = createTool(
  'Automatically generate Hono.js API endpoints from database schemas. PREREQUISITE: Database and migrations must be run first before using analyze_schema or generate_endpoints operations. Can analyze database tables, generate TypeScript types, and create Hono.js REST API routes with selective operations (create, read, update, delete). Perfect for generating only specific operations like "create or read only" APIs.',
  z.object({
    operation: z.enum(['analyze_schema', 'generate_types', 'generate_endpoints']).describe('Operation to perform: analyze_schema (inspect database tables - requires DB & migrations to be run first), generate_types (create TypeScript interfaces), generate_endpoints (create API endpoints with selected operations - requires DB & migrations to be run first)'),
    database: z.object({
      host: z.string().optional().describe('Database host (default: localhost)'),
      port: z.number().optional().describe('Database port (default: 3306)'),
      user: z.string().describe('Database username'),
      password: z.string().describe('Database password'),
      database: z.string().describe('Database name')
    }).describe('Database connection configuration'),
    tables: z.array(z.string()).optional().describe('Specific tables to process (if empty, processes all tables)'),
    operations: z.array(z.enum(['create', 'read', 'read_all', 'update', 'delete'])).optional().describe('Which HTTP operations to generate. Options: create (POST), read (GET by ID), read_all (GET all), update (PUT), delete (DELETE). If empty, generates all operations.'),
    outputDir: z.string().optional().describe('Output directory for generated files (default: src/backend/api for V3 template) - API routes are added to existing routes.ts'),
    apiPrefix: z.string().optional().describe('API prefix path (default: /api)'),
    generateTypes: z.boolean().optional().describe('Whether to generate TypeScript types (default: true)'),
    overwrite: z.boolean().optional().describe('Whether to overwrite existing files (default: false)')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for API generation - ensure agent is running in app context')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const result = await autoAPIGenerator.execute(app.path, input as AutoAPIGeneratorOptions)
    
    if (!result.success) {
      throw new Error(result.error || result.message || 'API generation failed')
    }

    let responseMessage = `✅ ${result.message}`
    
    if (result.data) {
      if (result.data.tables) {
        responseMessage += `\n\n📊 **Analyzed Tables:**\n${result.data.tables.map(t => `- ${t.name} (${t.columns.length} columns)`).join('\n')}`
      }
      
      if (result.data.generatedFiles) {
        responseMessage += `\n\n📁 **Generated Files:**\n${result.data.generatedFiles.map(f => `- ${f}`).join('\n')}`
      }
      
      if (result.data.endpoints) {
        const endpointsByTable = result.data.endpoints.reduce((acc, ep) => {
          if (!acc[ep.table]) acc[ep.table] = []
          acc[ep.table]?.push(ep)
          return acc
        }, {} as Record<string, any[]>)
        
        responseMessage += `\n\n🚀 **Generated Endpoints:**`
        for (const [table, endpoints] of Object.entries(endpointsByTable)) {
          responseMessage += `\n**${table}:**`
          for (const ep of endpoints) {
            responseMessage += `\n  - ${ep.method} ${ep.path} - ${ep.description}`
          }
        }
      }
    }
    
    return responseMessage
  }
)

import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { MemoryTool, MemorySetOptions, MemoryReadOptions, MemorySearchOptions } from '../memory-tool.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

// Initialize tool instances
const memoryTool = new MemoryTool()
const appRepo = new AppRepository()

/**
 * Memory Set Tool for AI-Lib
 * Store values in hierarchical memory using dot-delimited keys
 */
export const memorySetAITool = createTool(
  'Store a value in hierarchical memory using dot-delimited keys. Values can be JSON objects/arrays or plain text strings. Keys are persistent across agent executions within the same app.',
  z.object({
    key: z.string().describe('Dot-delimited hierarchical key (e.g., "user.preferences.theme" or "app.config.database.host")'),
    value: z.any().describe('Value to store - can be JSON object/array or plain text string')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for memory operations')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const result = await memoryTool.setMemory(input as MemorySetOptions, app.path, appId)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to set memory value')
    }

    return `✅ Memory key '${result.key}' set successfully`
  }
)

/**
 * Memory Read Tool for AI-Lib
 * Retrieve values from hierarchical memory using dot-delimited keys
 */
export const memoryReadAITool = createTool(
  'Retrieve a value from hierarchical memory using dot-delimited keys. Returns the stored value if it exists.',
  z.object({
    key: z.string().describe('Dot-delimited hierarchical key to read')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for memory operations')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const result = await memoryTool.readMemory(input as MemoryReadOptions, app.path, appId)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to read memory value')
    }

    if (!result.exists) {
      return `❌ Memory key '${result.key}' not found`
    }

    // Format the response based on value type
    let response = `📖 Memory key '${result.key}':\n`
    
    if (typeof result.value === 'object') {
      response += '```json\n' + JSON.stringify(result.value, null, 2) + '\n```'
    } else {
      response += `${result.value}`
    }
    
    return response
  }
)

/**
 * Memory Search Tool for AI-Lib
 * Search hierarchical memory using semantic similarity
 */
export const memorySearchAITool = createTool(
  'Search hierarchical memory using semantic similarity. Find stored values based on text meaning rather than exact key matching.',
  z.object({
    query: z.string().describe('Search query for semantic similarity'),
    limit: z.number().default(10).describe('Maximum number of results to return (default: 10)'),
    score_threshold: z.number().default(0.7).describe('Minimum similarity score threshold (0-1, default: 0.7)')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for memory operations')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const result = await memoryTool.searchMemory(input as MemorySearchOptions, app.path, appId)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to search memory')
    }

    if (!result.results || result.results.length === 0) {
      return `🔍 No memory entries found matching query: "${input.query}"`
    }

    // Format search results
    let response = `🔍 Found ${result.results.length} memory entries matching "${input.query}":\n\n`
    
    result.results.forEach((item, index) => {
      response += `${index + 1}. **${item.key}** (score: ${item.score?.toFixed(2) || 'N/A'})\n`
      
      if (typeof item.value === 'object') {
        response += '   ```json\n   ' + JSON.stringify(item.value, null, 2).replace(/\n/g, '\n   ') + '\n   ```\n'
      } else {
        const valueStr = String(item.value)
        const truncated = valueStr.length > 100 ? valueStr.substring(0, 100) + '...' : valueStr
        response += `   ${truncated}\n`
      }
      response += '\n'
    })
    
    return response.trim()
  }
)

/**
 * Memory List Keys Tool for AI-Lib
 * List all keys in memory with optional prefix filtering
 */
export const memoryListKeysAITool = createTool(
  'List all keys in memory with optional prefix filtering. Useful for discovering what data is stored.',
  z.object({
    prefix: z.string().optional().describe('Optional key prefix to filter results (e.g., "user" to find "user.name", "user.email", etc.)')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for memory operations')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const result = await memoryTool.listKeys(app.path, input.prefix, appId)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to list memory keys')
    }

    if (result.keys.length === 0) {
      const prefixMsg = input.prefix ? ` with prefix "${input.prefix}"` : ''
      return `📋 No memory keys found${prefixMsg}`
    }

    const prefixMsg = input.prefix ? ` (filtered by prefix "${input.prefix}")` : ''
    let response = `📋 Found ${result.keys.length} memory key(s)${prefixMsg}:\n\n`
    
    result.keys.forEach((key, index) => {
      response += `${index + 1}. ${key}\n`
    })
    
    return response.trim()
  }
)
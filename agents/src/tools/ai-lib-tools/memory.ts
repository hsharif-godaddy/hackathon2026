import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import {
  memoryService,
  memorySchemaRegistry as schemaRegistry,
  memoryContextProvider as contextProvider,
} from '../../services/memory-singletons.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

const appRepo = new AppRepository()

/**
 * Memory Tool for AI-Lib
 * Persistent key-value storage with schema validation and hooks
 */
export const memoryAITool: Tool = createTool(
  `Store and retrieve persistent memory across conversations using hierarchical keys.
  
Memory entries are stored as markdown files with YAML front matter in the app's .memory directory.
Keys use dot notation for namespacing (e.g., "app.title", "database.schema", "user.preferences").
All updates are automatically committed to git.

Operations:
- set: Create or update a memory entry
- get: Retrieve a memory entry by key
- delete: Remove a memory entry
- list: List all memory entries (optionally filtered by prefix)
- batch-get: Efficiently retrieve multiple entries at once`,
  z.object({
    operation: z.enum(['set', 'get', 'delete', 'list', 'batch-get']).describe('Operation to perform'),
    key: z.string().optional().describe('Memory key in dot notation (e.g., "app.title"). Required for set, get, delete operations.'),
    keys: z.array(z.string()).optional().describe('Array of keys for batch-get operation'),
    value: z.any().optional().describe('Value to store for set operation. Can be string, number, boolean, object, or array.'),
    prefix: z.string().optional().describe('Key prefix filter for list operation (e.g., "app" to list all app.* keys)')
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

    const { operation, key, keys, value, prefix } = input

    switch (operation) {
      case 'set': {
        if (!key) {
          throw new Error('Key is required for set operation')
        }
        if (value === undefined) {
          throw new Error('Value is required for set operation')
        }

        const validation = schemaRegistry.validateValue(key, value)
        if (!validation.valid) {
          throw new Error(`Validation failed: ${validation.error}`)
        }

        const existingEntry = await memoryService.get(app.path, key)
        const oldValue = existingEntry?.value

        const transformedValue = await schemaRegistry.executeBeforeSetHook(
          key,
          value,
          oldValue
        )

        const entry = await memoryService.set(
          app.path,
          appId,
          key,
          transformedValue
        )

        contextProvider.invalidateCache(appId, app.path)

        await schemaRegistry.executeAfterSetHook(
          key,
          transformedValue,
          oldValue
        )

        const valueDisplay = typeof entry.value === 'string'
          ? entry.value
          : JSON.stringify(entry.value)

        return `Set "${entry.fullKey}" = ${valueDisplay}`
      }

      case 'get': {
        if (!key) {
          throw new Error('Key is required for get operation')
        }

        const entry = await memoryService.get(app.path, key)

        if (!entry) {
          const defaultValue = schemaRegistry.getDefaultValue(key)
          
          if (defaultValue !== undefined) {
            return `Key "${key}" not found. Default value: ${JSON.stringify(defaultValue)}`
          }

          return `Key "${key}" not found`
        }

        const schema = schemaRegistry.get(entry.fullKey)
        const valueDisplay = typeof entry.value === 'string'
          ? entry.value
          : JSON.stringify(entry.value, null, 2)

        const lines: string[] = [
          `Key: ${entry.fullKey}`,
          `Value: ${valueDisplay}`,
          `Type: ${entry.type}`,
        ]

        if (schema?.description) {
          lines.push(`Description: ${schema.description}`)
        }

        lines.push(`Last updated: ${entry.updatedAt}`)

        return lines.join('\n')
      }

      case 'delete': {
        if (!key) {
          throw new Error('Key is required for delete operation')
        }

        const entry = await memoryService.get(app.path, key)

        if (!entry) {
          return `Key "${key}" not found`
        }

        const allowDelete = await schemaRegistry.executeBeforeDeleteHook(
          key,
          entry.value
        )

        if (!allowDelete) {
          throw new Error(`Delete operation prevented by beforeDelete hook for key: ${key}`)
        }

        const deleted = await memoryService.delete(app.path, appId, key)

        if (!deleted) {
          return `Key "${key}" not found`
        }

        contextProvider.invalidateCache(appId, app.path)

        await schemaRegistry.executeAfterDeleteHook(key, entry.value)

        return `Successfully deleted key "${key}"`
      }

      case 'list': {
        const entries = await memoryService.list(app.path, prefix)

        if (entries.length === 0) {
          return prefix
            ? `No entries found with prefix "${prefix}"`
            : 'No entries found'
        }

        const header = prefix
          ? `Found ${entries.length} entries with prefix "${prefix}":`
          : `Found ${entries.length} entries:`

        const lines: string[] = [header, '']

        for (const entry of entries) {
          const valueDisplay = typeof entry.value === 'string'
            ? entry.value.substring(0, 50) + (entry.value.length > 50 ? '...' : '')
            : JSON.stringify(entry.value)

          lines.push(`- ${entry.fullKey}: ${valueDisplay}`)
        }

        return lines.join('\n')
      }

      case 'batch-get': {
        if (!keys || keys.length === 0) {
          throw new Error('Keys array is required for batch-get operation')
        }

        const entries = await memoryService.batchGet(app.path, keys)

        const lines: string[] = [
          `Batch get results (${Object.keys(entries).length}/${keys.length} found):`,
          '',
        ]

        for (const k of keys) {
          const entry = entries[k]

          if (entry) {
            const valueDisplay = typeof entry.value === 'string'
              ? entry.value
              : JSON.stringify(entry.value)

            lines.push(`✓ ${k}: ${valueDisplay}`)
          } else {
            const defaultValue = schemaRegistry.getDefaultValue(k)
            
            if (defaultValue !== undefined) {
              lines.push(`- ${k}: (not found, default: ${JSON.stringify(defaultValue)})`)
            } else {
              lines.push(`- ${k}: (not found)`)
            }
          }
        }

        return lines.join('\n')
      }

      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  }
)

export { memoryService, schemaRegistry, contextProvider }

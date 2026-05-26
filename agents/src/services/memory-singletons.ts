import { MemoryService } from './memory-service.js'
import { MemorySchemaRegistry } from './memory-schema-registry.js'
import { MemoryContextProvider } from './memory-context-provider.js'
import { registerPredefinedSchemas } from './memory-predefined-schemas.js'

export const memoryService = new MemoryService()
export const memorySchemaRegistry = new MemorySchemaRegistry()
export const memoryContextProvider = new MemoryContextProvider(memoryService, memorySchemaRegistry)

registerPredefinedSchemas(memorySchemaRegistry)

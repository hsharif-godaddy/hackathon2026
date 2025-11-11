import { MemorySchema } from '../types/memory.js';
import { MemorySchemaRegistry } from './memory-schema-registry.js';
import { logger } from '../logging/index.js';

/**
 * Predefined memory schemas for common use cases
 * 
 * These schemas can be registered with the MemorySchemaRegistry to provide
 * validation, default values, and hooks for frequently used memory keys.
 */

/**
 * Get all predefined schemas
 * 
 * @returns Array of predefined memory schemas
 */
export function getPredefinedSchemas(): MemorySchema[] {
  return [
    {
      key: 'app.title',
      description: 'Application name/title',
      type: 'string',
      includeInContext: true,
      validator: (value) => {
        if (typeof value !== 'string') {
          return 'App title must be a string';
        }
        if (value.trim().length === 0) {
          return 'App title cannot be empty';
        }
        if (value.length > 100) {
          return 'App title must be 100 characters or less';
        }
        return true;
      },
      hooks: {
        afterSet: async (value, oldValue) => {
          logger.info('memory.predefined.app_title.updated', {
            newValue: value,
            oldValue,
          });
        },
      },
    },

    {
      key: 'app.description',
      description: 'Application description',
      type: 'string',
      includeInContext: true,
      validator: (value) => {
        if (typeof value !== 'string') {
          return 'App description must be a string';
        }
        if (value.length > 500) {
          return 'App description must be 500 characters or less';
        }
        return true;
      },
    },

    {
      key: 'user.preferences',
      description: 'User preferences and settings',
      type: 'object',
      includeInContext: false,
      defaultValue: {},
    },

    {
      key: 'features.flags',
      description: 'Feature flags configuration',
      type: 'object',
      includeInContext: false,
      defaultValue: {},
      hooks: {
        afterSet: async (value) => {
          logger.info('memory.predefined.feature_flags.updated', {
            flagCount: Object.keys(value).length,
            enabledFlags: Object.entries(value)
              .filter(([_, enabled]) => enabled === true)
              .map(([flag]) => flag),
          });
        },
      },
    },

    {
      key: 'config.theme',
      description: 'Application theme configuration',
      type: 'object',
      includeInContext: false,
      defaultValue: {
        mode: 'light',
        primaryColor: '#007bff',
      },
    },

    {
      key: 'metadata.updated_at',
      description: 'Timestamp when the app was last updated',
      type: 'string',
      includeInContext: false,
      hooks: {
        beforeSet: async (value) => {
          if (new Date(value).toString() === 'Invalid Date') {
            throw new Error('updated_at must be a valid ISO timestamp');
          }
          return value;
        },
      },
    },
  ];
}

/**
 * Register all predefined schemas with a schema registry
 * 
 * @param registry - MemorySchemaRegistry instance
 */
export function registerPredefinedSchemas(registry: MemorySchemaRegistry): void {
  const schemas = getPredefinedSchemas();
  
  for (const schema of schemas) {
    try {
      registry.register(schema);
    } catch (error) {
      logger.warn('memory.predefined.registration.failed', {
        key: schema.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('memory.predefined.registered', {
    count: schemas.length,
  });
}

import { MemorySchema, ValidationResult } from '../types/memory.js';
import { logger } from '../logging/index.js';

/**
 * Memory Schema Registry
 * 
 * Manages schema registration, validation, and hook execution for memory entries.
 * Provides centralized schema management with validation and lifecycle hooks.
 */
export class MemorySchemaRegistry {
  private schemas: Map<string, MemorySchema> = new Map();

  /**
   * Register a schema for a memory key
   * 
   * @param schema - Schema definition to register
   * @throws Error if schema key is invalid or already registered
   */
  register(schema: MemorySchema): void {
    if (!schema.key || typeof schema.key !== 'string') {
      throw new Error('Schema key must be a non-empty string');
    }

    if (this.schemas.has(schema.key)) {
      throw new Error(`Schema already registered for key: ${schema.key}`);
    }

    this.schemas.set(schema.key, schema);

    logger.info('memory.schema.registered', {
      key: schema.key,
      type: schema.type,
      includeInContext: schema.includeInContext || false,
      hasValidator: !!schema.validator,
      hasHooks: !!(schema.hooks?.beforeSet || schema.hooks?.afterSet || schema.hooks?.beforeDelete || schema.hooks?.afterDelete),
    });
  }

  /**
   * Unregister a schema by key
   * 
   * @param key - Full key path of schema to unregister
   * @returns true if unregistered, false if not found
   */
  unregister(key: string): boolean {
    const existed = this.schemas.delete(key);
    
    if (existed) {
      logger.info('memory.schema.unregistered', {
        key,
      });
    }

    return existed;
  }

  /**
   * Get a schema by key
   * 
   * @param key - Full key path
   * @returns Schema definition or undefined if not found
   */
  get(key: string): MemorySchema | undefined {
    return this.schemas.get(key);
  }

  /**
   * List all registered schemas, optionally filtered by prefix
   * 
   * @param prefix - Optional key prefix to filter by
   * @returns Array of matching schemas
   */
  list(prefix?: string): MemorySchema[] {
    const schemas = Array.from(this.schemas.values());

    if (prefix) {
      return schemas.filter(schema => schema.key.startsWith(prefix));
    }

    return schemas;
  }

  /**
   * Get all schemas marked for context inclusion
   * 
   * @returns Array of schemas with includeInContext: true
   */
  getContextSchemas(): MemorySchema[] {
    return Array.from(this.schemas.values()).filter(
      schema => schema.includeInContext === true
    );
  }

  /**
   * Validate a value against its schema
   * 
   * @param key - Full key path
   * @param value - Value to validate
   * @returns ValidationResult with valid flag and optional error message
   */
  validateValue(key: string, value: any): ValidationResult {
    const schema = this.schemas.get(key);

    if (!schema) {
      return { valid: true };
    }

    const typeValidation = this.validateType(schema.type, value);
    if (!typeValidation.valid) {
      return typeValidation;
    }

    if (schema.validator) {
      const customValidation = schema.validator(value);
      
      if (typeof customValidation === 'string') {
        return {
          valid: false,
          error: customValidation,
        };
      }

      if (!customValidation) {
        return {
          valid: false,
          error: 'Custom validation failed',
        };
      }
    }

    return { valid: true };
  }

  /**
   * Execute beforeSet hook if defined
   * 
   * @param key - Full key path
   * @param value - New value to be set
   * @param oldValue - Existing value (if any)
   * @returns Potentially transformed value
   * @throws Error if hook throws or returns invalid value
   */
  async executeBeforeSetHook(
    key: string,
    value: any,
    oldValue?: any
  ): Promise<any> {
    const schema = this.schemas.get(key);

    if (!schema?.hooks?.beforeSet) {
      return value;
    }

    try {
      logger.info('memory.hook.before_set.start', {
        key,
      });

      const transformedValue = await schema.hooks.beforeSet(value, oldValue);

      logger.info('memory.hook.before_set.success', {
        key,
        valueChanged: transformedValue !== value,
      });

      return transformedValue;
    } catch (error) {
      logger.error('memory.hook.before_set.failure', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new Error(
        `beforeSet hook failed for key ${key}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute afterSet hook if defined
   * 
   * @param key - Full key path
   * @param value - Value that was set
   * @param oldValue - Previous value (if any)
   */
  async executeAfterSetHook(
    key: string,
    value: any,
    oldValue?: any
  ): Promise<void> {
    const schema = this.schemas.get(key);

    if (!schema?.hooks?.afterSet) {
      return;
    }

    try {
      logger.info('memory.hook.after_set.start', {
        key,
      });

      await schema.hooks.afterSet(value, oldValue);

      logger.info('memory.hook.after_set.success', {
        key,
      });
    } catch (error) {
      logger.error('memory.hook.after_set.failure', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Execute beforeDelete hook if defined
   * 
   * @param key - Full key path
   * @param value - Value to be deleted
   * @returns true to allow deletion, false to prevent
   */
  async executeBeforeDeleteHook(key: string, value: any): Promise<boolean> {
    const schema = this.schemas.get(key);

    if (!schema?.hooks?.beforeDelete) {
      return true;
    }

    try {
      logger.info('memory.hook.before_delete.start', {
        key,
      });

      const allowDelete = await schema.hooks.beforeDelete(value);

      logger.info('memory.hook.before_delete.success', {
        key,
        allowDelete,
      });

      return allowDelete;
    } catch (error) {
      logger.error('memory.hook.before_delete.failure', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new Error(
        `beforeDelete hook failed for key ${key}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute afterDelete hook if defined
   * 
   * @param key - Full key path
   * @param value - Value that was deleted
   */
  async executeAfterDeleteHook(key: string, value: any): Promise<void> {
    const schema = this.schemas.get(key);

    if (!schema?.hooks?.afterDelete) {
      return;
    }

    try {
      logger.info('memory.hook.after_delete.start', {
        key,
      });

      await schema.hooks.afterDelete(value);

      logger.info('memory.hook.after_delete.success', {
        key,
      });
    } catch (error) {
      logger.error('memory.hook.after_delete.failure', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get default value for a key if schema defines one
   * 
   * @param key - Full key path
   * @returns Default value or undefined
   */
  getDefaultValue(key: string): any {
    const schema = this.schemas.get(key);
    return schema?.defaultValue;
  }

  /**
   * Check if a key has a registered schema
   * 
   * @param key - Full key path
   * @returns true if schema exists
   */
  hasSchema(key: string): boolean {
    return this.schemas.has(key);
  }

  /**
   * Clear all registered schemas
   */
  clear(): void {
    this.schemas.clear();
    logger.info('memory.schema.cleared', {
      message: 'All schemas cleared',
    });
  }

  /**
   * Validate type of a value
   * 
   * @param expectedType - Expected type from schema
   * @param value - Value to check
   * @returns ValidationResult with valid flag and optional error
   */
  private validateType(
    expectedType: MemorySchema['type'],
    value: any
  ): ValidationResult {
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    if (actualType === 'object' && value === null) {
      return {
        valid: false,
        error: `Expected type ${expectedType}, got null`,
      };
    }

    if (actualType !== expectedType) {
      return {
        valid: false,
        error: `Expected type ${expectedType}, got ${actualType}`,
      };
    }

    return { valid: true };
  }
}

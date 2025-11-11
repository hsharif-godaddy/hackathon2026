/**
 * Memory system type definitions
 * 
 * Defines interfaces for the memory tool system including entries, schemas,
 * hooks, and operations for persistent key-value storage across agent conversations.
 */

/**
 * Represents a single memory entry stored in the system
 * 
 * @interface MemoryEntry
 */
export interface MemoryEntry {
  /**
   * Namespace portion of the key (e.g., "app" from "app.title")
   */
  namespace: string;

  /**
   * Key portion without namespace (e.g., "title" from "app.title")
   */
  key: string;

  /**
   * Full key path with namespace (e.g., "app.title")
   */
  fullKey: string;

  /**
   * The stored value (can be any JSON-serializable type)
   */
  value: any;

  /**
   * Type of the value
   */
  type: "string" | "number" | "boolean" | "object" | "array" | "null";

  /**
   * Optional custom metadata
   */
  metadata?: Record<string, any>;

  /**
   * ISO timestamp when entry was created
   */
  createdAt: string;

  /**
   * ISO timestamp when entry was last updated
   */
  updatedAt: string;
}

/**
 * Hook functions that can be executed during memory operations
 * 
 * @interface MemoryHooks
 */
export interface MemoryHooks {
  /**
   * Executed before setting a value. Can transform the value.
   * 
   * @param value - The new value to be set
   * @param oldValue - The existing value (if any)
   * @returns The potentially transformed value to store
   * @throws Error to prevent the operation
   */
  beforeSet?: (value: any, oldValue?: any) => Promise<any>;

  /**
   * Executed after successfully setting a value
   * 
   * @param value - The value that was set
   * @param oldValue - The previous value (if any)
   */
  afterSet?: (value: any, oldValue?: any) => Promise<void>;

  /**
   * Executed before deleting a value. Can prevent deletion.
   * 
   * @param value - The value to be deleted
   * @returns false to prevent deletion, true to allow
   */
  beforeDelete?: (value: any) => Promise<boolean>;

  /**
   * Executed after successfully deleting a value
   * 
   * @param value - The value that was deleted
   */
  afterDelete?: (value: any) => Promise<void>;
}

/**
 * Schema definition for a memory entry
 * 
 * @interface MemorySchema
 */
export interface MemorySchema {
  /**
   * Full key path (e.g., "app.title")
   */
  key: string;

  /**
   * Human-readable description of what this memory entry stores
   */
  description?: string;

  /**
   * Expected type of the value
   */
  type: "string" | "number" | "boolean" | "object" | "array";

  /**
   * Default value if not set
   */
  defaultValue?: any;

  /**
   * Whether to include this entry in agent context automatically
   */
  includeInContext?: boolean;

  /**
   * Custom validation function
   * 
   * @param value - Value to validate
   * @returns true if valid, error message string if invalid
   */
  validator?: (value: any) => boolean | string;

  /**
   * Hook functions for this schema
   */
  hooks?: MemoryHooks;
}

/**
 * Operations supported by the memory tool
 * 
 * @type MemoryOperation
 */
export type MemoryOperation = "set" | "get" | "delete" | "list" | "batch-get";

/**
 * Parameters for memory tool operations
 * 
 * @interface MemoryToolParams
 */
export interface MemoryToolParams {
  /**
   * Operation to perform
   */
  operation: MemoryOperation;

  /**
   * Key for single-key operations (set, get, delete)
   */
  key?: string;

  /**
   * Keys for batch operations (batch-get)
   */
  keys?: string[];

  /**
   * Value to set (for set operation)
   */
  value?: any;

  /**
   * Prefix for list operation
   */
  prefix?: string;
}

/**
 * YAML front matter structure for memory files
 * 
 * @interface MemoryFileFrontMatter
 */
export interface MemoryFileFrontMatter {
  namespace: string;
  key: string;
  value: any;
  type: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result of a validation operation
 * 
 * @interface ValidationResult
 */
export interface ValidationResult {
  /**
   * Whether the validation passed
   */
  valid: boolean;

  /**
   * Error message if validation failed
   */
  error?: string;
}

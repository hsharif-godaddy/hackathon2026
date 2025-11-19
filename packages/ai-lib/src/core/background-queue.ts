import { createLogger } from '../utils/logger.js'
import type { AgentFactory, HandoffContext } from './agent-factory.js'
import type { AgentContext } from './types.js'

const logger = createLogger('background-queue')

/**
 * Check if a value is a plain object (created with {} or new Object())
 * 
 * @param value - Value to check
 * @returns True if value is a plain object
 */
function isPlainObject(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  
  const proto = Object.getPrototypeOf(value)
  // Plain objects have Object.prototype or null as their prototype
  return proto === Object.prototype || proto === null
}

/**
 * Sanitize metadata to remove non-serializable objects using whitelist approach
 * 
 * Only allows:
 * - Primitives (string, number, boolean, null, undefined)
 * - Plain objects (created with {} or new Object())
 * - Arrays
 * - Date objects (serializable to ISO string)
 * 
 * @param metadata - Metadata object that may contain non-serializable values
 * @returns Sanitized metadata with only serializable values
 */
function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  
  for (const [key, value] of Object.entries(metadata)) {
    // Skip functions
    if (typeof value === 'function') {
      continue
    }
    
    // Allow primitives
    if (value === null || value === undefined) {
      sanitized[key] = value
      continue
    }
    
    if (typeof value !== 'object') {
      // string, number, boolean, bigint, symbol
      sanitized[key] = value
      continue
    }
    
    // Allow Arrays (check before plain object as arrays are also objects)
    if (Array.isArray(value)) {
      try {
        JSON.stringify(value)
        sanitized[key] = value
      } catch {
        // Skip if circular or non-serializable
        continue
      }
      continue
    }
    
    // Allow Date objects
    if (value instanceof Date) {
      sanitized[key] = value
      continue
    }
    
    // Allow plain objects only
    if (isPlainObject(value)) {
      try {
        JSON.stringify(value)
        sanitized[key] = value
      } catch {
        // Skip if circular or non-serializable
        continue
      }
      continue
    }
    
    // Skip everything else (class instances, Map, Set, Timeout, etc.)
  }
  
  return sanitized
}

/**
 * Background task for generic delegation
 */
interface BackgroundTask {
  /** Task description to delegate */
  task: string
  /** Additional context to pass to the target agent */
  context?: Record<string, unknown>
  /** Execution context to pass through */
  executionContext: AgentContext
  /** Resolve function for the promise */
  resolve: (value: unknown) => void
  /** Reject function for the promise */
  reject: (error: Error) => void
}

/**
 * Background processing queue for sequential async task delegation
 * Processes tasks one at a time, ensuring each task can build on previous ones
 */
export class BackgroundQueue {
  private queue: BackgroundTask[] = []
  private processing = false
  private factory: AgentFactory
  private sourceAgentId: string
  private targetAgentId: string

  constructor(
    factory: AgentFactory,
    sourceAgentId: string,
    targetAgentId: string
  ) {
    this.factory = factory
    this.sourceAgentId = sourceAgentId
    this.targetAgentId = targetAgentId
  }

  /**
   * Add a task to the queue
   * 
   * @param task - Task description to delegate
   * @param executionContext - Execution context (appId, sessionId, etc.)
   * @param context - Optional additional context to pass to the target agent
   * @returns Promise that resolves when the task is completed
   */
  async enqueue(
    task: string,
    executionContext: AgentContext,
    context?: Record<string, unknown>
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const backgroundTask: BackgroundTask = {
        task,
        executionContext,
        resolve,
        reject
      }
      
      if (context) {
        backgroundTask.context = context
      }
      
      this.queue.push(backgroundTask)

      // Start processing if not already running
      if (!this.processing) {
        this.processQueue()
      }
    })
  }

  /**
   * Process the queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return
    }

    this.processing = true

    while (this.queue.length > 0) {
      const task = this.queue.shift()
      if (!task) {
        break
      }

      try {
        logger.info('Background: Executing task', { task: task.task })

        // Execute handoff with execution context
        // Convert AgentContext to Record<string, unknown> for executeHandoff
        // Only include serializable properties, exclude non-serializable objects
        const executionContext: Record<string, unknown> = task.executionContext ? {
          ...(task.executionContext.messages && { messages: task.executionContext.messages }),
          ...(task.executionContext.initialContextMessages && { initialContextMessages: task.executionContext.initialContextMessages }),
          ...(task.executionContext.sessionId && { sessionId: task.executionContext.sessionId }),
          ...(task.executionContext.userId && { userId: task.executionContext.userId }),
          // Sanitize metadata to remove non-serializable objects
          ...(task.executionContext.metadata && {
            metadata: sanitizeMetadata(task.executionContext.metadata)
          }),
          ...(task.executionContext.timestamp && { timestamp: task.executionContext.timestamp }),
          ...(task.executionContext.files && { files: task.executionContext.files })
        } : {}

        // Create handoff context with the task
        // Don't include executionContext in context field to avoid circular references
        const handoffContext: HandoffContext = {
          task: task.task,
          context: task.context || {},
          metadata: {
            sourceAgent: this.sourceAgentId,
            timestamp: new Date().toISOString(),
            reason: 'Background task delegation'
          }
        }

        const result = await this.factory.executeHandoff(
          this.sourceAgentId,
          this.targetAgentId,
          handoffContext,
          executionContext
        )

        if (result.success) {
          logger.info('Background: Task completed', { task: task.task })
          task.resolve(result.result)
        } else {
          const error = new Error(result.error || 'Failed to execute background task')
          logger.error('Background: Failed to execute task', { task: task.task, error })
          task.reject(error)
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.error('Background: Error executing task', { task: task.task, error: err })
        task.reject(err)
      }
    }

    this.processing = false
  }

  /**
   * Get the current queue length
   */
  getQueueLength(): number {
    return this.queue.length
  }

  /**
   * Check if queue is currently processing
   */
  isProcessing(): boolean {
    return this.processing
  }
}


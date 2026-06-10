import { tool, zodSchema, type Tool, type ToolExecutionOptions } from 'ai'
import type { z } from 'zod'
import type { ToolDefinition, AgentContext } from '../core/types.js'

export type { Tool } from 'ai'

/**
 * Base class for creating tools
 */
export abstract class BaseTool implements ToolDefinition {
  abstract readonly name: string
  abstract readonly description: string
  abstract readonly inputSchema: z.ZodSchema

  /** Provider-specific options */
  providerOptions?: Record<string, unknown>

  /**
   * Execute the tool
   */
  abstract execute(input: unknown, context?: AgentContext): Promise<unknown>

  /**
   * Convert to AI SDK tool format
   */
  toAISDKTool() {
    return tool<unknown, unknown>({
      description: this.description,
      inputSchema: zodSchema(this.inputSchema),
      execute: async (input: unknown, options: ToolExecutionOptions) => {
        const context = options?.experimental_context as AgentContext | undefined
        const toolCallId = (options as unknown as Record<string, unknown> | undefined)?.toolCallId as string | undefined
        if (context && toolCallId) {
          const meta = (context.metadata ?? {}) as Record<string, unknown>
          meta.toolId = toolCallId
          context.metadata = meta
        }
        return this.execute(input, context)
      },
      ...(this.providerOptions ? { providerOptions: this.providerOptions as NonNullable<Tool['providerOptions']> } : {})
    })
  }

  /**
   * Validate input against schema
   */
  protected validateInput<T = unknown>(input: unknown): T {
    return this.inputSchema.parse(input) as T
  }

  /**
   * Handle errors consistently
   */
  protected handleError(error: unknown): never {
    if (error instanceof Error) {
      throw error
    }
    throw new Error(String(error))
  }
}

/**
 * Create a tool that's directly compatible with AI SDK
 */
export function createTool<T extends z.ZodType<any, any>>(
  description: string,
  inputSchema: T,
  execute: (input: z.infer<T>, context?: AgentContext) => Promise<unknown>,
  options?: {
    providerOptions?: Record<string, unknown>
  }
): Tool {
  return tool<z.infer<T>, unknown>({
    description,
    inputSchema: zodSchema(inputSchema),
    execute: async (input: z.infer<T>, executionOptions: ToolExecutionOptions) => {
      const context = executionOptions?.experimental_context as AgentContext | undefined
      const toolCallId = (executionOptions as unknown as Record<string, unknown> | undefined)?.toolCallId as string | undefined
      if (context && toolCallId) {
        const meta = (context.metadata ?? {}) as Record<string, unknown>
        meta.toolId = toolCallId
        context.metadata = meta
      }
      return execute(input, context)
    },
    ...(options?.providerOptions ? { providerOptions: options.providerOptions as NonNullable<Tool['providerOptions']> } : {})
  })
}

/**
 * @deprecated Use createTool() directly - it now returns AI SDK Tool
 * Convert tool definition to AI SDK tool
 */
export function toAISDKTool(toolDef: ToolDefinition) {
  return tool<unknown, unknown>({
    description: toolDef.description,
    inputSchema: zodSchema(toolDef.inputSchema),
    execute: async (input: unknown, options: ToolExecutionOptions) => {
      const context = options?.experimental_context as AgentContext | undefined
      const toolCallId = (options as unknown as Record<string, unknown> | undefined)?.toolCallId as string | undefined
      if (context && toolCallId) {
        const meta = (context.metadata ?? {}) as Record<string, unknown>
        meta.toolId = toolCallId
        context.metadata = meta
      }
      return toolDef.execute(input, context)
    },
    ...(toolDef.providerOptions ? { providerOptions: toolDef.providerOptions as NonNullable<Tool['providerOptions']> } : {})
  })
}

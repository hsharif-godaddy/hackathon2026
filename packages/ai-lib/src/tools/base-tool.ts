import { tool, type Tool } from 'ai'
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
    return tool({
      description: this.description,
      // @ts-expect-error schema generic mismatch
      inputSchema: this.inputSchema,
      // @ts-expect-error execute generic mismatch
      execute: async (input: unknown) => this.execute(input),
      ...(this.providerOptions ? { providerOptions: this.providerOptions } : {})
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
export function createTool<T extends z.ZodSchema>(
  description: string,
  inputSchema: T,
  execute: (input: z.infer<T>, context?: AgentContext) => Promise<unknown>,
  options?: {
    providerOptions?: Record<string, unknown>
  }
): Tool & { executeWithContext?: (input: z.infer<T>, context?: AgentContext) => Promise<unknown> } {
  const toolInstance = tool({
    description,
    // @ts-expect-error generic mismatch
    inputSchema,
    // @ts-expect-error execute generic mismatch
    execute: async (input: z.infer<T>) => {
      return execute(input)
    },
    ...(options?.providerOptions ? { providerOptions: options.providerOptions } : {})
  })

  ;(toolInstance as Tool & { executeWithContext?: typeof execute }).executeWithContext = execute

  return toolInstance as Tool & { executeWithContext?: (input: z.infer<T>, context?: AgentContext) => Promise<unknown> }
}

/**
 * @deprecated Use createTool() directly - it now returns AI SDK Tool
 * Convert tool definition to AI SDK tool
 */
export function toAISDKTool(toolDef: ToolDefinition) {
  return tool({
    description: toolDef.description,
    // @ts-expect-error zod schema typing not yet aligned with AI SDK FlexibleSchema
    inputSchema: toolDef.inputSchema,
    // @ts-expect-error execute generic mismatch
  execute: async (input: unknown) => toolDef.execute(input),
    ...(toolDef.providerOptions ? { providerOptions: toolDef.providerOptions } : {})
  })
}

import { tool, type Tool } from 'ai'
import type { z } from 'zod'
import type { ToolDefinition, AgentContext } from '../core/types.js'

/**
 * Base class for creating tools
 */
export abstract class BaseTool implements ToolDefinition {
  abstract readonly name: string
  abstract readonly description: string
  abstract readonly inputSchema: z.ZodSchema
  
  /** Provider-specific options */
  providerOptions?: Record<string, any>

  /**
   * Execute the tool
   */
  abstract execute(input: any, context?: AgentContext): Promise<any>

  /**
   * Convert to AI SDK tool format
   */
  toAISDKTool() {
    return tool({
      description: this.description,
      inputSchema: this.inputSchema,
      execute: async (input) => this.execute(input),
      ...(this.providerOptions ? { providerOptions: this.providerOptions } : {})
    })
  }

  /**
   * Validate input against schema
   */
  protected validateInput(input: any): any {
    return this.inputSchema.parse(input)
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
  execute: (input: z.infer<T>, context?: AgentContext) => Promise<any>,
  options?: {
    providerOptions?: Record<string, any>
  }
): Tool & { executeWithContext?: (input: z.infer<T>, context?: AgentContext) => Promise<any> } {
  const toolInstance = tool({
    description,
    inputSchema,
    execute: async (input) => execute(input),
    ...(options?.providerOptions ? { providerOptions: options.providerOptions } : {})
  })
  
  // Add a custom method for context-aware execution
  ;(toolInstance as any).executeWithContext = execute
  
  return toolInstance as Tool & { executeWithContext?: (input: z.infer<T>, context?: AgentContext) => Promise<any> }
}

/**
 * @deprecated Use createTool() directly - it now returns AI SDK Tool
 * Convert tool definition to AI SDK tool
 */
export function toAISDKTool(toolDef: ToolDefinition) {
  return tool({
    description: toolDef.description,
    inputSchema: toolDef.inputSchema,
    execute: async (input) => toolDef.execute(input),
    ...(toolDef.providerOptions ? { providerOptions: toolDef.providerOptions } : {})
  })
}

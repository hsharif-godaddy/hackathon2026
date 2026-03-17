import type {
  ContextPipeline,
  TransformContextInput,
  TransformContextOutput,
  ConvertToLlmInput,
} from '@airo/ai-lib'
import { defaultConvertToLlm, buildUserMessage } from '@airo/ai-lib'
import type { ModelMessage } from 'ai'
import type { AILibContextManager } from './context-manager.js'

export interface AgentContextPipelineOptions {
  /** Maximum tokens for conversation history. Passed to history loader. */
  maxHistoryTokens?: number
  /** Context manager for future use (loading will move into transformContext). */
  contextManager?: AILibContextManager
}

export class AgentContextPipeline implements ContextPipeline {
  constructor(private options?: AgentContextPipelineOptions) {}

  async transformContext(
    input: TransformContextInput
  ): Promise<TransformContextOutput> {
    // Context messages and conversation history are already provided
    // by the caller (loaded via AILibContextManager before pipeline invocation).
    // The pipeline's job is to apply any additional transformations.
    return {
      contextMessages: input.contextMessages,
      conversationMessages: input.conversationMessages,
      userMessage: buildUserMessage(input.userMessage, input.files),
    }
  }

  convertToLlm(input: ConvertToLlmInput): ModelMessage[] {
    return defaultConvertToLlm(input)
  }
}

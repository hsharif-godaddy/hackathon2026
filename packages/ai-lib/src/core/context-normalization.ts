import type { ModelMessage, UserModelMessage, LanguageModel } from 'ai'
import type { ContextPipeline, PipelineContextMessage, ConvertToLlmInput } from './context-pipeline.js'
import type { ProcessedFile } from './types.js'
import { addCacheControlToMessages } from '../utils/prompt-caching.js'
import { buildHybridContent } from '../utils/image-content-builder.js'

/**
 * Provider-specific options for cache point conversion.
 * Matches the ProviderOptions shape used in agent-factory.ts.
 */
interface ProviderOptions {
  anthropic?: {
    cacheControl?: { type: string }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * Message with optional cachePoint metadata (stored format).
 */
type MessageWithCachePoint = ModelMessage & {
  cachePoint?: { type: string }
  providerOptions?: ProviderOptions
}

/**
 * Convert cachePoint metadata to provider-specific options format.
 * Populates Anthropic format for prompt caching.
 */
function applyCachePointToProviderOptions(
  cachePoint: { type: string },
  existingProviderOptions: ProviderOptions
): ProviderOptions {
  return {
    ...existingProviderOptions,
    anthropic: {
      ...(existingProviderOptions.anthropic || {}),
      cacheControl: { type: cachePoint.type },
    },
  }
}

/**
 * Normalize pipeline context messages into ModelMessage format.
 * Converts cachePoint metadata to provider-specific options.
 *
 * Extracted from prepareCall context normalization (lines 357-387 of agent-factory.ts).
 */
export function normalizeContextMessages(
  messages: PipelineContextMessage[]
): ModelMessage[] {
  const result: ModelMessage[] = []
  for (const msg of messages) {
    // Preserve existing providerOptions and merge in cache hints
    const existingProviderOptions: ProviderOptions = (msg.providerOptions as ProviderOptions) || {}
    let providerOptions: ProviderOptions = { ...existingProviderOptions }

    if (msg.cachePoint) {
      providerOptions = applyCachePointToProviderOptions(msg.cachePoint, providerOptions)
    }

    if (Object.keys(providerOptions).length > 0) {
      result.push({
        role: msg.role,
        content: msg.content,
        providerOptions,
      } as ModelMessage)
    } else {
      result.push({
        role: msg.role,
        content: msg.content,
      } as ModelMessage)
    }
  }
  return result
}

/**
 * Normalize conversation messages, converting cachePoint metadata to provider options.
 *
 * Extracted from prepareCall conversation normalization (lines 389-420 of agent-factory.ts).
 */
export function normalizeConversationMessages(
  messages: ModelMessage[]
): ModelMessage[] {
  const result: ModelMessage[] = []
  for (const msg of messages) {
    const msgWithCache = msg as MessageWithCachePoint
    if (msgWithCache.cachePoint) {
      const existingProviderOptions: ProviderOptions = msgWithCache.providerOptions || {}
      const providerOptions = applyCachePointToProviderOptions(
        msgWithCache.cachePoint,
        existingProviderOptions
      )
      // Create normalized message without cachePoint property
      const { cachePoint, ...messageWithoutCache } = msgWithCache
      result.push({
        ...messageWithoutCache,
        providerOptions,
      })
    } else {
      result.push(msg)
    }
  }
  return result
}

/**
 * Detect if this is the first turn of a conversation.
 * First turn = no assistant messages in history.
 */
function isFirstTurn(messages: ModelMessage[]): boolean {
  return !messages.some((msg) => msg.role === 'assistant')
}

/**
 * Apply prompt caching strategy to assembled messages.
 * First-turn vs subsequent-turn logic.
 *
 * Extracted from prepareCall caching logic (lines 452-476 of agent-factory.ts).
 */
export function applyPromptCaching(
  allMessages: ModelMessage[],
  currentUserMessage: ModelMessage | undefined,
  model: LanguageModel,
  conversationMessages: ModelMessage[],
  enablePromptCaching: boolean | { cacheSystemPrompts?: boolean; maxBreakpoints?: number },
  hasSystemPrompt: boolean = true
): { messages: ModelMessage[]; userMessage: ModelMessage | undefined } {
  if (!enablePromptCaching) {
    return { messages: allMessages, userMessage: currentUserMessage }
  }

  const cachingStrategy =
    typeof enablePromptCaching === 'object' ? enablePromptCaching : {}

  let resultMessages = allMessages
  let resultUserMessage: ModelMessage | undefined = currentUserMessage

  if (currentUserMessage && isFirstTurn(conversationMessages)) {
    // First turn (no prior conversation): cache stable prefix ONLY.
    // Do NOT cache the user message — after_history content will be inserted
    // between the cached prefix and the user message, so caching the user message
    // would include after_history content in the cached prefix, causing cache
    // invalidation on every request when after_history changes.
    // Only reserve a system prompt breakpoint slot when a system prompt was
    // actually set (addCacheControlToSystemPrompt places the breakpoint on
    // ToolLoopAgent instructions, not in the messages array).
    const effectiveCachingStrategy = { ...cachingStrategy, cacheSystemPrompts: hasSystemPrompt }
    resultMessages = addCacheControlToMessages(
      allMessages,
      model,
      effectiveCachingStrategy
    )
    // User message returned unchanged (no cache breakpoint)
    resultUserMessage = currentUserMessage
  } else {
    // Subsequent turns or empty-prompt turns: cache context/history messages.
    // Disable system message caching here — the system prompt is already cached
    // at the ToolLoopAgent level, so context messages with role 'system' in the
    // messages array should not consume cache breakpoints.
    resultMessages = addCacheControlToMessages(allMessages, model, {
      ...cachingStrategy,
      cacheSystemPrompts: false,
    })
  }

  return { messages: resultMessages, userMessage: resultUserMessage }
}

/**
 * Default convertToLlm implementation.
 * Composes normalization + caching into the pipeline's Stage 2.
 *
 * CRITICAL: Cache breakpoint must be placed on the last conversation history message,
 * NOT on after_history content (knowb, todo, dynamic data). after_history content is
 * query-dependent and changes every request - including it in the cached prefix would
 * cause constant cache invalidation and excessive cache writes.
 */
export function defaultConvertToLlm(input: ConvertToLlmInput): ModelMessage[] {
  // Split context messages by insertionOrder
  const beforeHistory = input.contextMessages.filter(
    (m) => m.insertionOrder !== 'after_history'
  )
  const afterHistory = input.contextMessages.filter(
    (m) => m.insertionOrder === 'after_history'
  )

  const beforeNormalized = normalizeContextMessages(beforeHistory)
  const afterNormalized = normalizeContextMessages(afterHistory)
  const conversationNormalized = normalizeConversationMessages(
    input.conversationMessages
  )

  // Build stable prefix (before_history + conversation) for caching
  // This prefix is mostly stable across requests and should have the cache breakpoint
  let stablePrefixMessages: ModelMessage[] = [
    ...beforeNormalized,
    ...conversationNormalized,
  ]
  let userMessage: ModelMessage | undefined = input.userMessage

  // Apply cache breakpoint to stable prefix ONLY (not including after_history)
  // This ensures the breakpoint lands on the last history message, preserving cache
  // even when after_history content (knowb, todo, dynamic data) changes.
  //
  // Anthropic cache breakpoint limit (4 max) is enforced in addCacheControlToMessages():
  // - Counts existing breakpoints in stablePrefixMessages (e.g., memory summary from history loader)
  // - Reserves 1 for system prompt (if hasSystemPrompt = true)
  // - Adds 1 for last history message
  // - Total breakpoints: 1 (memory) + 1 (system) + 1 (history) = 3 ≤ 4 ✓
  if (input.enablePromptCaching) {
    const cached = applyPromptCaching(
      stablePrefixMessages,
      userMessage,
      input.model,
      conversationNormalized,
      input.enablePromptCaching,
      input.hasSystemPrompt ?? true
    )
    stablePrefixMessages = cached.messages
    userMessage = cached.userMessage
  }

  // Assemble final message array: cached prefix + dynamic after_history content
  // after_history content comes AFTER the cache breakpoint and doesn't invalidate cache
  const allMessages: ModelMessage[] = [
    ...stablePrefixMessages,
    ...afterNormalized,
  ]

  if (userMessage) {
    allMessages.push(userMessage)
  }

  return allMessages
}

/**
 * Build a UserModelMessage from raw prompt text and optional files.
 * Handles empty prompts (returns undefined), file attachments (via buildHybridContent),
 * and plain text messages. Shared by DEFAULT_PIPELINE and AgentContextPipeline.
 */
export function buildUserMessage(
  userMessage: string,
  files?: ProcessedFile[]
): UserModelMessage | undefined {
  const trimmed = userMessage.trim()
  if (files && files.length > 0) {
    return buildHybridContent(trimmed || 'Analyze the attached content.', files)
  }
  if (trimmed) {
    return { role: 'user', content: trimmed }
  }
  return undefined
}

/**
 * Default ContextPipeline singleton.
 * Stateless — passes through messages and uses defaultConvertToLlm for Stage 2.
 */
const DEFAULT_PIPELINE: ContextPipeline = {
  async transformContext(input) {
    return {
      contextMessages: input.contextMessages,
      conversationMessages: input.conversationMessages,
      userMessage: buildUserMessage(input.userMessage, input.files),
    }
  },
  convertToLlm(input) {
    return defaultConvertToLlm(input)
  },
}

/**
 * Get the default ContextPipeline implementation.
 * Used when agents don't provide their own pipeline.
 */
export function createDefaultPipeline(): ContextPipeline {
  return DEFAULT_PIPELINE
}

import { getModelProvider } from '@airo/ai-lib'

/** Provider label used on Langfuse invocation spans. Narrower than ai-lib's
 * `ModelProvider` only by nominal type — both are `'anthropic' | 'openai'`. */
export type ChatLlmProvider = 'anthropic' | 'openai'

/** Infer the Langfuse provider label from a model name by delegating to
 * `@airo/ai-lib`'s `getModelProvider`, which is the source of truth for
 * how this codebase routes models at runtime (Gemini / GLM / unknown → the
 * OpenAI-compatible provider; Claude → anthropic). Keeping attribution in
 * lockstep with runtime routing avoids misleading provider labels on spans. */
export function inferProviderFromModelName(modelName: string): ChatLlmProvider {
  return getModelProvider(modelName)
}

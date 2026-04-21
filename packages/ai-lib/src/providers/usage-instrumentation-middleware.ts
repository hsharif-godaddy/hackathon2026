/**
 * Cost Tracking Middleware for Vercel AI SDK
 *
 * Uses LanguageModelV3Middleware to record LLM call costs on the active OTel
 * span. Works with both streaming (wrapStream) and non-streaming (wrapGenerate)
 * calls by reading the typed usage data the SDK already parsed — no raw SSE
 * byte parsing, no buffering, no risk of breaking the stream.
 *
 * Stopgap until GoCode returns cost headers on streaming Anthropic responses.
 */

import { createLogger } from '@airo/ai-common'
import type {
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider'
import { createCostRecorder } from '@godaddy/agent-otel-sdk'
import type { LanguageModelMiddleware } from 'ai'

import { calculateCostEstimate, type TokenUsage } from '../utils/model-pricing.js'

const logger = createLogger('usage-instrumentation')

type CostRecorderFn = (cost: { totalCost: number, inputCost?: number, outputCost?: number }) => void

function toTokenUsage(usage: LanguageModelV3Usage): TokenUsage {
  return {
    inputTokens: usage.inputTokens.total ?? 0,
    outputTokens: usage.outputTokens.total ?? 0,
    totalTokens: (usage.inputTokens.total ?? 0) + (usage.outputTokens.total ?? 0),
    ...(usage.inputTokens.cacheRead != null && { cachedInputTokensRead: usage.inputTokens.cacheRead }),
    ...(usage.inputTokens.cacheWrite != null && { cachedInputTokensWrite: usage.inputTokens.cacheWrite })
  }
}

function record(recorder: CostRecorderFn, usage: LanguageModelV3Usage, modelId: string) {
  const estimate = calculateCostEstimate(toTokenUsage(usage), modelId)
  if (estimate.totalCost > 0) {
    recorder({
      totalCost: estimate.totalCost,
      inputCost: estimate.inputCost,
      outputCost: estimate.outputCost
    })
  }
}

export function createCostTrackingMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate, model }) => {
      const result = await doGenerate()

      try {
        record(createCostRecorder(), result.usage, model.modelId)
      } catch (err) {
        logger.warn('usageInstrumentation.generate.error', { error: err instanceof Error ? err.message : String(err) })
      }

      return result
    },

    wrapStream: async ({ doStream, model }) => {
      // Capture recorder eagerly while the LLM span is the active OTel span;
      // by flush() time the async context may have shifted.
      let recorder: CostRecorderFn | undefined
      try {
        recorder = createCostRecorder()
      } catch (err) {
        logger.warn('usageInstrumentation.stream.recorderInit', { error: err instanceof Error ? err.message : String(err) })
      }

      let capturedUsage: LanguageModelV3Usage | undefined
      const result = await doStream()

      if (!recorder) return result

      // Capture as const so TypeScript narrows correctly in the flush() closure
      const costRecorder = recorder
      const wrapped = result.stream.pipeThrough(
        new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(part, controller) {
            controller.enqueue(part)
            if (part.type === 'finish') {
              capturedUsage = part.usage
            }
          },
          flush() {
            if (!capturedUsage) return
            try {
              record(costRecorder, capturedUsage, model.modelId)
            } catch (err) {
              logger.warn('usageInstrumentation.stream.error', { error: err instanceof Error ? err.message : String(err) })
            }
          }
        })
      )

      return { ...result, stream: wrapped }
    }
  }
}

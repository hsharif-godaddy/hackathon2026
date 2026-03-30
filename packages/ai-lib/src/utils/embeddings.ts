/**
 * Embeddings utility for consistent API across different providers
 * Handles provider-specific implementations while maintaining a unified interface
 */

import { createLogger } from '@airo/ai-common'
import type { EmbeddingOptions, EmbeddingsResult } from '../core/types.js'
import { llmMetadataContext, type LitellmMetadata } from '../providers/unified-provider.js'

const logger = createLogger('embeddings')

export interface EmbeddingModel {
  provider: 'openai' | 'anthropic' | 'custom'
  modelId: string
  instance?: any // The actual model instance from AI SDK
}

/**
 * Generate embeddings using the appropriate provider implementation
 * @param values - String or array of strings to generate embeddings for
 * @param model - Embedding model to use
 * @param options - Embedding options
 * @param metadata - Optional LiteLLM metadata for cost tracking (wraps call with AsyncLocalStorage)
 */
export async function generateEmbeddings(
  values: string | string[],
  model: EmbeddingModel | any, // Support both our interface and raw AI SDK models
  options: EmbeddingOptions = {},
  metadata?: LitellmMetadata
): Promise<EmbeddingsResult> {
  const textsArray = Array.isArray(values) ? values : [values]

  // Detect model type and handle accordingly
  const modelInfo = analyzeModel(model)

  // Wrap with metadata context if provided
  const generateFn = async () => {
    switch (modelInfo.provider) {
      case 'openai':
        return await generateOpenAIEmbeddings(textsArray, modelInfo, options)
      default:
        // Try to use AI SDK directly for other providers
        return await generateGenericEmbeddings(textsArray, model, options)
    }
  }

  // Run with metadata context if provided
  return metadata
    ? await llmMetadataContext.run(metadata, generateFn)
    : await generateFn()
}

/**
 * Analyze a model to determine its provider and capabilities
 */
function analyzeModel(model: any): EmbeddingModel {
  // If it's already our EmbeddingModel interface
  if (model && typeof model === 'object' && 'provider' in model) {
    return model as EmbeddingModel
  }

  // Try to detect provider from model properties
  if (model && typeof model === 'object') {
    // Check for OpenAI model
    if (model.modelId?.includes('text-embedding') ||
        model.constructor?.name?.includes('OpenAI')) {
      return {
        provider: 'openai',
        modelId: model.modelId || 'text-embedding-ada-002',
        instance: model
      }
    }
  }

  // If it's a string, try to detect from string
  if (typeof model === 'string') {
    if (model.includes('text-embedding')) {
      return {
        provider: 'openai',
        modelId: model,
        instance: null
      }
    }
  }

  // Fallback to custom
  return {
    provider: 'custom',
    modelId: typeof model === 'string' ? model : 'unknown',
    instance: model
  }
}

/**
 * Generate embeddings using OpenAI (via AI SDK)
 */
async function generateOpenAIEmbeddings(
  texts: string[],
  modelInfo: EmbeddingModel,
  options: EmbeddingOptions
): Promise<EmbeddingsResult> {
  try {
    const { embedMany } = await import('ai')
    
    const embedOptions: any = {
      model: modelInfo.instance,
      values: texts
    }
    
    if (options.dimensions) {
      embedOptions.dimensions = options.dimensions
    }
    
    const result = await embedMany(embedOptions)
    
    // Transform AI SDK result to our format
    const transformedEmbeddings = result.embeddings.map((embeddingResult: any) => ({
      embedding: embeddingResult.embedding,
      dimensions: embeddingResult.embedding.length
    }))
    
    return {
      embeddings: transformedEmbeddings,
      usage: result.usage ? {
        inputTokens: result.usage.tokens || 0,
        outputTokens: 0,
        totalTokens: result.usage.tokens || 0
      } : undefined,
      metadata: {
        model: modelInfo.modelId,
        provider: 'openai',
        ...options.metadata
      }
    }
  } catch (error) {
    logger.error('OpenAI embeddings error', error)
    throw new Error(`Failed to generate OpenAI embeddings: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Generate embeddings using AI SDK directly (fallback for other providers)
 */
async function generateGenericEmbeddings(
  texts: string[],
  model: any,
  options: EmbeddingOptions
): Promise<EmbeddingsResult> {
  try {
    const { embedMany } = await import('ai')
    
    const embedOptions: any = {
      model,
      values: texts
    }
    
    if (options.dimensions) {
      embedOptions.dimensions = options.dimensions
    }
    
    const result = await embedMany(embedOptions)
    
    // Transform AI SDK result to our format
    const transformedEmbeddings = result.embeddings.map((embeddingResult: any, idx: number) => {
      const embedding = embeddingResult.embedding || embeddingResult
      if (
        !Array.isArray(embedding) ||
        !embedding.every((v: any) => typeof v === 'number')
      ) {
        throw new Error(
          `Invalid embedding at index ${idx}: expected array of numbers, got ${JSON.stringify(embedding)}`
        )
      }
      return {
        embedding,
        dimensions: embedding.length
      }
    })
    
    return {
      embeddings: transformedEmbeddings,
      usage: result.usage ? {
        inputTokens: result.usage.tokens || 0,
        outputTokens: 0,
        totalTokens: result.usage.tokens || 0
      } : undefined,
      metadata: {
        model: typeof model === 'string' ? model : 'unknown',
        provider: 'generic',
        ...options.metadata
      }
    }
  } catch (error) {
    logger.error('Generic embeddings error', error)
    throw new Error(`Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Cosine similarity utility (useful for embedding comparisons)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length')
  }
  
  const dotProduct = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0)
  const magnitudeA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
  const magnitudeB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0
  }
  
  return dotProduct / (magnitudeA * magnitudeB)
}

/**
 * Find most similar texts using cosine similarity
 */
export function findMostSimilar(
  queryEmbedding: number[],
  embeddings: number[][],
  texts: string[],
  topK: number = 5
): Array<{ text: string, similarity: number, index: number }> {
  const similarities = embeddings.map((embedding, index) => ({
    text: texts[index] || '',
    similarity: cosineSimilarity(queryEmbedding, embedding),
    index
  }))
  
  return similarities
    .filter(item => item.text.length > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
}
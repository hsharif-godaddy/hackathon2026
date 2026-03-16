import { QdrantClient } from '@qdrant/js-client-rest';
import { logger } from '../logging/index.js';
import { getEmbeddingModel, generateEmbeddings, llmMetadataContext } from '@airo/ai-lib';

export interface VectorSearchOptions {
  query: string;
  limit?: number;
  score_threshold?: number;
  collection?: string;
}

export interface VectorSearchResult {
  success: boolean;
  results?: Array<{
    key: string;
    value: unknown;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  error?: string;
}

export interface VectorStoreOptions {
  key: string;
  value: unknown;
  text: string;
  metadata?: Record<string, unknown>;
  collection?: string;
}

export interface VectorStoreResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Qdrant Vector Database Service
 * Provides vector storage and semantic search capabilities for the memory tool
 */
export class QdrantService {
  private client: QdrantClient;
  private readonly defaultCollection = 'memory_vectors';
  private readonly logger = logger.child({ module: 'QdrantService' });
  
  // Vector configuration - OpenAI text-embedding-3-small dimensions
  private static readonly VECTOR_DIMENSIONS = 1536;
  private static readonly VECTOR_DISTANCE = 'Cosine' as const;
  private static readonly EMBEDDING_MODEL = 'text-embedding-3-small';
  
  // Retry configuration
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 1000;
  
  // Metrics tracking
  private metrics = {
    totalOperations: 0,
    failedOperations: 0,
    retriedOperations: 0,
    lastFailureTime: null as Date | null,
    lastFailureReason: null as string | null
  };

  constructor(url?: string) {
    const qdrantUrl = url || process.env.QDRANT_URL || 'http://localhost:6333';
    this.client = new QdrantClient({ 
      url: qdrantUrl,
      checkCompatibility: false
    });
    
    this.logger.info('qdrant.service.init', {
      url: qdrantUrl,
      defaultCollection: this.defaultCollection,
      vectorDimensions: QdrantService.VECTOR_DIMENSIONS,
      maxRetries: QdrantService.MAX_RETRIES
    });
  }

  /**
   * Sleep for specified milliseconds
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute operation with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    context: Record<string, unknown> = {}
  ): Promise<T> {
    this.metrics.totalOperations++;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= QdrantService.MAX_RETRIES; attempt++) {
      try {
        const result = await operation();
        
        // Log retry success if this wasn't the first attempt
        if (attempt > 1) {
          this.metrics.retriedOperations++;
          this.logger.info('qdrant.retry.success', {
            operation: operationName,
            attempt,
            ...context
          });
        }
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < QdrantService.MAX_RETRIES) {
          const delayMs = QdrantService.RETRY_DELAY_MS * attempt; // Exponential backoff
          
          this.logger.warn('qdrant.retry.attempt', {
            operation: operationName,
            attempt,
            maxRetries: QdrantService.MAX_RETRIES,
            delayMs,
            error: lastError.message,
            ...context
          });
          
          await this.sleep(delayMs);
        }
      }
    }

    // All retries failed
    this.metrics.failedOperations++;
    this.metrics.lastFailureTime = new Date();
    this.metrics.lastFailureReason = lastError?.message || 'Unknown error';

    this.logger.error('qdrant.retry.exhausted', {
      operation: operationName,
      maxRetries: QdrantService.MAX_RETRIES,
      error: lastError?.message,
      ...context
    });

    throw lastError;
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalOperations > 0 
        ? ((this.metrics.totalOperations - this.metrics.failedOperations) / this.metrics.totalOperations) * 100 
        : 100,
      retryRate: this.metrics.totalOperations > 0
        ? (this.metrics.retriedOperations / this.metrics.totalOperations) * 100
        : 0
    };
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics() {
    this.metrics = {
      totalOperations: 0,
      failedOperations: 0,
      retriedOperations: 0,
      lastFailureTime: null,
      lastFailureReason: null
    };
  }

  /**
   * Ensure collection exists with proper configuration
   */
  async ensureCollection(collectionName?: string): Promise<void> {
    const collection = collectionName || this.defaultCollection;
    
    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections?.some(c => c.name === collection);
      
      if (!exists) {
        this.logger.info('qdrant.collection.create.begin', { collection });
        
        // Create collection with configured dimensions for embedding model
        await this.client.createCollection(collection, {
          vectors: {
            size: QdrantService.VECTOR_DIMENSIONS,
            distance: QdrantService.VECTOR_DISTANCE
          }
        });
        
        this.logger.info('qdrant.collection.create.success', { collection });
      }
    } catch (error) {
      this.logger.error('qdrant.collection.create.failure', { 
        collection,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Generate text embedding using OpenAI text-embedding-3-small
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const model = await getEmbeddingModel(QdrantService.EMBEDDING_MODEL);

      const existingMetadata = llmMetadataContext.getStore();

      const result = await generateEmbeddings(text, model, {}, existingMetadata);

      if (!result.embeddings || result.embeddings.length === 0) {
        throw new Error('No embeddings returned');
      }

      const embedding = result.embeddings[0];
      if (!embedding) {
        throw new Error('First embedding is undefined');
      }

      return embedding.embedding;
    } catch (error) {
      this.logger.error('qdrant.embedding.failure', {
        textLength: text.length,
        model: QdrantService.EMBEDDING_MODEL,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }


  /**
   * Store a vector in Qdrant with retry mechanism
   */
  async storeVector(options: VectorStoreOptions): Promise<VectorStoreResult> {
    const startTime = Date.now();
    const collection = options.collection || this.defaultCollection;
    
    this.logger.info('qdrant.vector.store.begin', {
      key: options.key,
      collection,
      textLength: options.text.length
    });

    try {
      const result = await this.executeWithRetry(
        async () => {
          // Ensure collection exists
          await this.ensureCollection(collection);
          
          // Generate embedding from text
          const vector = await this.generateEmbedding(options.text);
          
          // Generate unique ID based on key
          const id = this.generateId(options.key);
          
          // Store in Qdrant
          await this.client.upsert(collection, {
            wait: true,
            points: [{
              id: id,
              vector: vector,
              payload: {
                key: options.key,
                value: options.value,
                text: options.text,
                timestamp: Date.now(),
                ...(options.metadata && { metadata: options.metadata })
              }
            }]
          });

          return id;
        },
        'storeVector',
        {
          key: options.key,
          collection,
          textLength: options.text.length
        }
      );

      const duration = Date.now() - startTime;
      this.logger.info('qdrant.vector.store.success', {
        key: options.key,
        collection,
        id: result,
        duration
      });

      return {
        success: true,
        id: result.toString()
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('qdrant.vector.store.failure', {
        key: options.key,
        collection,
        duration,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Search for similar vectors with retry mechanism
   */
  async searchVectors(options: VectorSearchOptions): Promise<VectorSearchResult> {
    const startTime = Date.now();
    const collection = options.collection || this.defaultCollection;
    const limit = options.limit || 10;
    const scoreThreshold = options.score_threshold ?? 0.5;

    this.logger.info('qdrant.vector.search.begin', {
      query: options.query,
      collection,
      limit,
      scoreThreshold
    });

    try {
      const searchResult = await this.executeWithRetry(
        async () => {
          // Generate embedding for query
          const queryVector = await this.generateEmbedding(options.query);
          
          // Search in Qdrant
          return await this.client.search(collection, {
            vector: queryVector,
            limit,
            score_threshold: scoreThreshold,
            with_payload: true
          });
        },
        'searchVectors',
        {
          query: options.query,
          collection,
          limit,
          scoreThreshold
        }
      );

      const results = searchResult.map(point => {
        const result: {
          key: string;
          value: unknown;
          score: number;
          metadata?: Record<string, unknown>;
        } = {
          key: point.payload?.key as string,
          value: point.payload?.value as unknown,
          score: point.score
        };
        
        const metadata = point.payload?.metadata as Record<string, unknown> | undefined;
        if (metadata) {
          result.metadata = metadata;
        }
        
        return result;
      });

      const duration = Date.now() - startTime;
      this.logger.info('qdrant.vector.search.success', {
        query: options.query,
        collection,
        resultsCount: results.length,
        duration
      });

      return {
        success: true,
        results
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('qdrant.vector.search.failure', {
        query: options.query,
        collection,
        duration,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Delete a vector by key
   */
  async deleteVector(key: string, collection?: string): Promise<boolean> {
    const col = collection || this.defaultCollection;
    
    try {
      const id = this.generateId(key);
      await this.client.delete(col, {
        wait: true,
        points: [id]
      });
      
      this.logger.info('qdrant.vector.delete.success', { key, collection: col, id });
      return true;
    } catch (error) {
      this.logger.error('qdrant.vector.delete.failure', {
        key,
        collection: col,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Generate consistent ID from key
   */
  private generateId(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Health check for Qdrant connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch (error) {
      this.logger.error('qdrant.health.failure', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
}

// Export singleton instance
export const qdrantService = new QdrantService();
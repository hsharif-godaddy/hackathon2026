import { generateText, streamText, experimental_generateImage, type LanguageModel } from 'ai'
import type {
  AgentConfig,
  AgentContext,
  AgentResult,
  ToolExecutionResult,
  ImageGenerationOptions,
  ImageGenerationResult,
  EmbeddingOptions,
  EmbeddingsResult,
  FileInput,
  FileInputContext
} from './types.js'
import { createSimpleMessageBuilder, type MessageBuilder } from './message-builder.js'

/**
 * Core Agent class - lightweight wrapper around AI SDK 5
 */
export class Agent {
  private config: {
    name: string
    systemPrompt: string
    model: string | LanguageModel
    tools: any[] | Record<string, any>
    temperature: number
    maxTokens: number
    enableLoopControl: boolean
    providerOptions: any
  }
  private messageBuilder: MessageBuilder

  constructor(config: AgentConfig) {
    // Set defaults
    this.config = {
      name: config.name,
      systemPrompt: config.systemPrompt || '',
      model: config.model || 'gpt-4o',
      tools: config.tools || [],
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 2000,
      enableLoopControl: config.enableLoopControl ?? false,
      providerOptions: config.providerOptions || {}
    }

    // Initialize message builder
    if (config.messageBuilder) {
      this.messageBuilder = config.messageBuilder
    } else if (config.systemPrompt) {
      // Use simple message builder with system prompt
      this.messageBuilder = createSimpleMessageBuilder(config.systemPrompt)
    } else {
      // Fallback to empty system prompt
      this.messageBuilder = createSimpleMessageBuilder('')
    }

    // Initialize agentic runner
  }

  /**
   * Get agent configuration
   */
  getConfig() {
    return { ...this.config }
  }

  /**
   * Get the message builder being used
   */
  getMessageBuilder(): MessageBuilder {
    return this.messageBuilder
  }

  /**
   * Generate a response (non-streaming)
   */
  async generate(
    input: string,
    context?: AgentContext
  ): Promise<AgentResult> {
    const messages = this.messageBuilder.buildMessages(input, context)

    const generateOptions: any = {
      model: this.resolveModel(),
      messages,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
    }

    if (this.hasTools()) {
      generateOptions.tools = this.buildToolsObject()
    }

    const result = await generateText(generateOptions)

    // Debug logging if enabled
    if (process.env.DEBUG === 'true') {
      console.log('🔍 Raw AI SDK Response:', JSON.stringify(result, null, 2))
    }

    return this.formatResult(result)
  }

  /**
   * Generate a streaming response
   */
  async *generateStream(
    input: string,
    context?: AgentContext
  ): AsyncGenerator<string, AgentResult, unknown> {
    const messages = this.messageBuilder.buildMessages(input, context)

    const streamOptions: any = {
      model: this.resolveModel(),
      messages,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
    }

    if (this.hasTools()) {
      streamOptions.tools = this.buildToolsObject()
    }

    const result = streamText(streamOptions)

    let fullContent = ''

    // Stream text chunks
    for await (const textPart of result.textStream) {
      fullContent += textPart
      yield textPart
    }

    // Wait for final result and return it
    const finalResult = await result

    return await this.formatStreamResult(finalResult, fullContent)
  }



  /**
   * Execute with tools and return detailed tool results
   */
  async executeWithTools(
    input: string,
    context?: AgentContext
  ): Promise<AgentResult & { toolExecutions: ToolExecutionResult[] }> {
    const result = await this.generate(input, context)

    const toolExecutions: ToolExecutionResult[] = []

    if (result.toolCalls) {
      for (const toolCall of result.toolCalls) {
        const startTime = Date.now()

        try {
          const toolExecution: ToolExecutionResult = {
            toolName: toolCall.name,
            input: toolCall.input,
            output: toolCall.result,
            executionTime: Date.now() - startTime,
            success: true
          }

          toolExecutions.push(toolExecution)
        } catch (error) {
          const toolExecution: ToolExecutionResult = {
            toolName: toolCall.name,
            input: toolCall.input,
            output: null,
            executionTime: Date.now() - startTime,
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }

          toolExecutions.push(toolExecution)
        }
      }
    }

    return {
      ...result,
      toolExecutions
    }
  }

  /**
   * Generate images using the configured model
   */
  async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const model = this.resolveModel()

    // Check if the model supports image generation
    if (!model || typeof model === 'string') {
      throw new Error('Image generation requires a LanguageModel instance that supports image generation')
    }

    try {
      const generateOptions: any = {
        model: model as any, // Cast to any since experimental_generateImage expects specific model types
        prompt: options.prompt
      }

      // Only add optional properties if they have values
      if (options.n !== undefined) generateOptions.n = options.n
      if (options.size !== undefined) generateOptions.size = options.size
      if (options.aspectRatio !== undefined) generateOptions.aspectRatio = options.aspectRatio
      if (options.seed !== undefined) generateOptions.seed = options.seed
      if (options.providerOptions !== undefined) generateOptions.providerOptions = options.providerOptions
      if (options.maxRetries !== undefined) generateOptions.maxRetries = options.maxRetries
      if (options.abortSignal !== undefined) generateOptions.abortSignal = options.abortSignal

      const result = await experimental_generateImage(generateOptions)

      // Transform the result to match our interface
      const images = result.images.map((image: any) => ({
        url: image.url,
        base64: image.base64,
        metadata: {
          size: image.size,
          aspectRatio: image.aspectRatio,
          seed: image.seed,
          revisedPrompt: image.revisedPrompt
        }
      }))

      return {
        images,
        usage: undefined, // AI SDK experimental_generateImage doesn't return usage info yet
        metadata: (result as any).experimental_providerMetadata ? {
          providerMetadata: (result as any).experimental_providerMetadata
        } : undefined
      }
    } catch (error) {
      console.error('Error generating image:', error)
      throw error
    }
  }

  /**
   * Generate embeddings for the given text(s)
   */

  async generateEmbeddings(
    values: string | string[],
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingsResult> {
    // Use the provided model or fallback to the agent's model (if it's an embedding model)
    const embeddingModel = options.model || this.config.model

    if (!embeddingModel) {
      throw new Error('Embedding generation requires a model to be specified')
    }

    try {
      // Use our embeddings helper for consistent API across providers
      const { generateEmbeddings } = await import('../utils/embeddings.js')

      return await generateEmbeddings(values, embeddingModel, options)
    } catch (error) {
      console.error('Error generating embeddings:', error)
      throw error
    }
  }

  /**
   * Process files and generate response based on file contents
   */
  async processFiles(
      files: FileInput[],
      prompt: string,
      context ?: AgentContext
    ): Promise < AgentResult & { fileContext: FileInputContext } > {
      try {
        // Import file processor dynamically to avoid loading it unless needed
        const { processFiles } = await import('../utils/file-processor.js')

      // Process all files
      const fileContext = await processFiles(files)

      // Generate response using file context
      const result = await this.generateWithFiles(prompt, fileContext, context)
      
      return {
          ...result,
          fileContext
        }
      } catch(error) {
        console.error('Error processing files:', error)
        throw error
      }
    }

    /**
     * Process files and stream response based on file contents
     */
    async * processFilesStream(
      files: FileInput[],
      prompt: string,
      context ?: AgentContext
    ): AsyncGenerator < string, AgentResult & { fileContext: FileInputContext }, unknown > {
      console.log('🤖 Agent.processFilesStream called with:', {
        fileCount: files.length,
        prompt: prompt.substring(0, 100) + '...',
        hasContext: !!context
      })
    
    try {
        console.log('📦 Importing file processor...')
      // Import file processor dynamically
      const { processFiles } = await import('../utils/file-processor.js')
      console.log('✅ File processor imported successfully')
      
      console.log('🔄 Processing files...')
      // Process all files
      const fileContext = await processFiles(files)
      console.log('✅ Files processed, file context created:', {
          fileCount: fileContext.files.length,
          summary: fileContext.summary
        })
      
      console.log('🔄 Starting streaming response generation...')
      // Stream response using file context
      const generator = this.generateStreamWithFiles(prompt, fileContext, context)
      
      let totalStreamedChunks = 0

      // The generator yields strings and returns the final result
      // We need to capture both the yielded strings and the return value
      let generatorResult: IteratorResult<string, AgentResult>

      // Iterate through all yielded values (strings)
      while(true) {
          generatorResult = await generator.next()

          if (generatorResult.done) {
            // Generator completed - generatorResult.value is the final AgentResult
            console.log('✅ Generator completed with final result')
            break
          } else {
            // Generator yielded a string chunk
            totalStreamedChunks++
            console.log('📝 Streaming text chunk:', {
              chunkNumber: totalStreamedChunks,
              length: generatorResult.value.length,
              preview: generatorResult.value.substring(0, 50) + '...'
            })
            yield generatorResult.value
          }
        }
      
      console.log('🏁 Streaming completed:', {
          totalChunks: totalStreamedChunks,
          hasFinalResult: !!generatorResult.value
        })
      
      if(!generatorResult.value) {
      throw new Error('No final result received from streaming generator')
    }

    return {
      ...generatorResult.value,
      fileContext
    }
  } catch(error) {
    console.error('Error processing files with streaming:', error)
    throw error
  }
}

  /**
   * Process a single file and generate response
   */
  async processFile(
  file: FileInput,
  prompt: string,
  context ?: AgentContext
): Promise < AgentResult & { fileContext: FileInputContext } > {
  return this.processFiles([file], prompt, context)
}

  /**
   * Analyze file contents without additional prompt
   */
  async analyzeFiles(
  files: FileInput[],
  analysisType: 'summary' | 'detailed' | 'extract' | 'compare' = 'summary',
  context ?: AgentContext
): Promise < AgentResult & { fileContext: FileInputContext } > {
  const analysisPrompts = {
    summary: 'Please provide a concise summary of the content in the provided files.',
    detailed: 'Please provide a detailed analysis of the content in the provided files, including key points, themes, and insights.',
    extract: 'Please extract and list the key information, data points, and important details from the provided files.',
    compare: 'Please compare and contrast the content across the provided files, highlighting similarities, differences, and relationships.'
  }
    
    return this.processFiles(files, analysisPrompts[analysisType], context)
}

  /**
   * Build enhanced prompt with file context
   */
  private buildFilePrompt(userPrompt: string, fileContext: FileInputContext): string {
  const parts: string[] = []

  // Add file summary
  if (fileContext.summary) {
    parts.push(`Files processed: ${fileContext.summary}`)
  }

  // Add individual file information
  fileContext.files.forEach((file, index) => {
    parts.push(`\n--- File ${index + 1}: ${file.metadata.filename || 'Unknown'} ---`)

    if (file.input.description) {
      parts.push(`Description: ${file.input.description}`)
    }

    parts.push(`Type: ${file.metadata.mimeType}`)
    parts.push(`Size: ${file.metadata.size} bytes`)

    if (file.warnings && file.warnings.length > 0) {
      parts.push(`Warnings: ${file.warnings.join(', ')}`)
    }

    if (file.textContent) {
      parts.push(`Content:\n${file.textContent}`)
    }

    if (file.structuredData) {
      parts.push(`Structured Data:\n${JSON.stringify(file.structuredData, null, 2)}`)
    }

    if (file.base64Content) {
      parts.push(`[Image content available as base64 - ${file.base64Content.length} characters]`)
    }
  })

  // Add user prompt
  parts.push(`\n--- User Request ---`)
  parts.push(userPrompt)

  return parts.join('\n')
}

  /**
   * Generate response with file context using message builder
   */
  private async generateWithFiles(
  input: string,
  fileContext: FileInputContext,
  context ?: AgentContext
): Promise < AgentResult > {
  // Use message builder's file support if available, otherwise fallback to prompt building
  const messages = this.messageBuilder.buildMessagesWithFiles
    ? this.messageBuilder.buildMessagesWithFiles(input, fileContext, context)
    : this.messageBuilder.buildMessages(this.buildFilePrompt(input, fileContext), context)
    
    const generateOptions: any = {
    model: this.resolveModel(),
    messages,
    temperature: this.config.temperature,
    maxOutputTokens: this.config.maxTokens,
  }
    
    if(this.hasTools()) {
  generateOptions.tools = this.buildToolsObject()
}

const result = await generateText(generateOptions)
return this.formatResult(result)
  }

  /**
   * Generate streaming response with file context using message builder
   */
  private async * generateStreamWithFiles(
  input: string,
  fileContext: FileInputContext,
  context ?: AgentContext
): AsyncGenerator < string, AgentResult, unknown > {
  console.log('🔨 generateStreamWithFiles called with:', {
    input: input.substring(0, 100) + '...',
    fileCount: fileContext.files.length,
    hasContext: !!context
  })

    // Use message builder's file support if available, otherwise fallback to prompt building
    const messages = this.messageBuilder.buildMessagesWithFiles
    ? this.messageBuilder.buildMessagesWithFiles(input, fileContext, context)
    : this.messageBuilder.buildMessages(this.buildFilePrompt(input, fileContext), context)
    
    console.log('📨 Messages built for AI:', {
      messageCount: messages.length,
      hasImages: messages.some(m => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image')),
      firstMessage: messages[0] ? {
        role: messages[0].role,
        contentType: Array.isArray(messages[0].content) ? 'multi-part' : 'text',
        contentLength: Array.isArray(messages[0].content) ? messages[0].content.length : (messages[0].content as string).length
      } : null
    })
    
    const streamOptions: any = {
    model: this.resolveModel(),
    messages,
    temperature: this.config.temperature,
    maxOutputTokens: this.config.maxTokens,
  }
    
    if(this.hasTools()) {
  streamOptions.tools = this.buildToolsObject()
}

console.log('🚀 Starting streamText with options:', {
  model: typeof streamOptions.model,
  messageCount: streamOptions.messages.length,
  temperature: streamOptions.temperature,
  maxOutputTokens: streamOptions.maxOutputTokens,
  hasTools: !!streamOptions.tools
})

const result = streamText(streamOptions)
console.log('✅ streamText result created')

let fullContent = ''
let chunkCount = 0

console.log('🔄 Starting to iterate over textStream...')

try {
  // Stream text chunks
  for await (const textPart of result.textStream) {
    chunkCount++
    console.log('📝 Received textPart:', {
      chunkNumber: chunkCount,
      length: textPart.length,
      preview: textPart.substring(0, 50) + '...'
    })
    fullContent += textPart
    yield textPart
  }

  console.log('✅ Finished streaming text chunks:', {
    totalChunks: chunkCount,
    totalLength: fullContent.length
  })

  // Wait for final result and return it
  console.log('⏳ Waiting for final result...')
  const finalResult = await result
  console.log('✅ Final result received')

  const formattedResult = await this.formatStreamResult(finalResult, fullContent)
  console.log('✅ Result formatted and ready to return')

  return formattedResult
} catch (error) {
  console.error('❌ Error in generateStreamWithFiles:', error)
  throw error
}
  }

  /**
   * Resolve model to LanguageModel instance
   */
  private resolveModel(): LanguageModel {
    if (typeof this.config.model === 'string') {
      // Try to resolve from provider registry
      try {
        // Use dynamic require for now due to circular dependency concerns
        const providerConfig = eval('require("../providers/provider-config.js")')
        const { providerRegistry } = providerConfig
        
        // Check if it's a registered provider
        if (providerRegistry.has(this.config.model)) {
          return providerRegistry.get(this.config.model)
        }
        
        // Fallback to default provider
        return providerRegistry.getDefault()
      } catch (error) {
        throw new Error(`Failed to resolve string model '${this.config.model}': ${error instanceof Error ? error.message : String(error)}. Either provide a LanguageModel instance or register providers.`)
      }
    }

    return this.config.model
  }

/**
 * Check if agent has tools configured
 */
hasTools(): boolean {
  if (Array.isArray(this.config.tools)) {
    return this.config.tools.length > 0
  }
  return Object.keys(this.config.tools || {}).length > 0
}

/**
 * Get the tools configured for this agent
 */
getTools(): Record < string, any > {
  if(Array.isArray(this.config.tools)) {
  // Convert array to object for easier lookup
  const toolsObject: Record<string, any> = {}
  for (const tool of this.config.tools) {
    if (tool.name) {
      toolsObject[tool.name] = tool
    }
  }
  return toolsObject
}
return this.config.tools || {}
  }

  /**
   * Build tools object for AI SDK
   */
  private buildToolsObject(): Record < string, any > {
  // If tools is already an object, return it directly
  if(!Array.isArray(this.config.tools)) {
  return this.config.tools || {}
}

// Convert array to object with generic names (legacy support)
const toolsObject: Record<string, any> = {}
for (let i = 0; i < this.config.tools.length; i++) {
  toolsObject[`tool_${i}`] = this.config.tools[i]
}

return toolsObject
  }

  /**
   * Extract caching metrics from AI SDK result
   */
  private extractCachingMetrics(result: any): any {
  const caching: any = {}

  // Extract from usage
  if (result.usage?.cachedInputTokens !== undefined) {
    caching.cachedInputTokens = result.usage.cachedInputTokens
  }

  // Extract from provider metadata (Bedrock)
  if (result.experimental_providerMetadata?.bedrock?.usage?.cacheWriteInputTokens !== undefined) {
    caching.cacheWriteInputTokens = result.experimental_providerMetadata.bedrock.usage.cacheWriteInputTokens
  }

  // Check if caching was enabled
  if (this.config.providerOptions?.anthropic?.cacheControl ||
    this.config.providerOptions?.bedrock?.cachePoint) {
    caching.cachingEnabled = true
  }

  // Calculate cache hit rate if we have the data
  if (caching.cachedInputTokens !== undefined && result.usage?.inputTokens) {
    caching.cacheHitRate = caching.cachedInputTokens / (result.usage.inputTokens + caching.cachedInputTokens)
  }

  return Object.keys(caching).length > 0 ? caching : undefined
}

  /**
   * Format result from generateText
   */
  private formatResult(result: any): AgentResult {
  // Capture all available metadata for debugging/tracing
  const metadata: Record<string, unknown> = {}

  // Add provider metadata if available
  if (result.experimental_providerMetadata) {
    metadata.providerMetadata = result.experimental_providerMetadata
  }

  // Add raw response metadata (for debugging)
  if (result.response) {
    metadata.rawResponse = {
      id: result.response.id,
      headers: result.response.headers,
      timestamp: result.response.timestamp
    }
  }

  // Add any additional fields from the result
  const knownFields = new Set(['text', 'toolCalls', 'usage', 'finishReason', 'experimental_providerMetadata', 'response'])
  for (const [key, value] of Object.entries(result)) {
    if (!knownFields.has(key)) {
      metadata[key] = value
    }
  }

  // Create a map of tool call results for easy lookup
  const toolResultsMap = new Map()
  if (result.toolResults) {
    for (const toolResult of result.toolResults) {
      toolResultsMap.set(toolResult.toolCallId, toolResult.output)
    }
  }

  return {
    content: result.text || '',
    toolCalls: Array.isArray(result.toolCalls) ? result.toolCalls.map((call: any) => ({
      id: call.toolCallId,
      name: call.toolName,
      input: call.input,
      result: toolResultsMap.get(call.toolCallId)
    })) : [],
    usage: result.usage ? {
      inputTokens: result.usage.inputTokens || 0,
      outputTokens: result.usage.outputTokens || 0,
      totalTokens: result.usage.totalTokens || 0,
      cachedInputTokens: result.usage.cachedInputTokens
    } : undefined,
    finishReason: result.finishReason,
    caching: this.extractCachingMetrics(result),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  }
}

  /**
   * Format result from streamText
   */
  private async formatStreamResult(result: any, content: string): Promise < AgentResult > {
  // Capture all available metadata for debugging/tracing
  const metadata: Record<string, unknown> = { }

// Add provider metadata if available
if (result.experimental_providerMetadata) {
  metadata.providerMetadata = result.experimental_providerMetadata
}

// Add raw response metadata (for debugging)
if (result.response) {
  metadata.rawResponse = {
    id: result.response.id,
    headers: result.response.headers,
    timestamp: result.response.timestamp
  }
}

// Add any additional fields from the result
const knownFields = new Set(['text', 'toolCalls', 'usage', 'finishReason', 'experimental_providerMetadata', 'response'])
for (const [key, value] of Object.entries(result)) {
  if (!knownFields.has(key)) {
    metadata[key] = value
  }
}

// Await toolCalls if it's a promise
let toolCalls: Array<{
  id: string
  name: string
  input: any
  result?: any
}> = []
if (result.toolCalls) {
  try {
    const resolvedToolCalls = await result.toolCalls
    if (Array.isArray(resolvedToolCalls)) {
      toolCalls = resolvedToolCalls.map((call: any) => ({
        id: call.toolCallId,
        name: call.toolName,
        input: call.input,
        result: call.result
      }))
    }
  } catch (error) {
    console.error('Error awaiting toolCalls:', error)
  }
}

// Await usage if it's a promise
let usage: any = undefined
if (result.usage) {
  try {
    usage = await result.usage
  } catch (error) {
    console.error('Error awaiting usage:', error)
  }
}

// Debug usage data for troubleshooting
if (process.env.NODE_ENV === 'development') {
  console.log('🔍 Agent formatStreamResult usage debug:', {
    hasUsage: !!result.usage,
    usageType: typeof result.usage,
    usageValue: result.usage,
    resolvedUsage: usage,
    resultKeys: Object.keys(result || {})
  })
}

return {
  content,
  toolCalls,
  usage: usage ? {
    inputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    totalTokens: usage.totalTokens || 0,
    cachedInputTokens: usage.cachedInputTokens
  } : undefined,
  finishReason: result.finishReason,
  caching: this.extractCachingMetrics(result),
  metadata: Object.keys(metadata).length > 0 ? metadata : undefined
}
  }
}

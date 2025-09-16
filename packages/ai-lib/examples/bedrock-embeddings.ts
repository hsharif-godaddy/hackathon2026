/**
 * Example: Generating embeddings using AWS Bedrock
 * 
 * This example demonstrates how to:
 * 1. Set up a Bedrock embedding model
 * 2. Generate embeddings for text using the Agent class
 * 3. Calculate similarity between embeddings
 * 
 * Prerequisites:
 * - Install: npm install @ai-sdk/amazon-bedrock
 * - Set AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)
 * - Or use IAM roles if running on AWS
 */

import { Agent, bedrockModels, type EmbeddingsResult } from '../src/index.js'

// Helper function to calculate cosine similarity between two embeddings
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimensions')
  }

  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))

  return dotProduct / (magnitudeA * magnitudeB)
}

async function runEmbeddingsExample() {
  console.log('🚀 AWS Bedrock Embeddings Example')
  console.log('=====================================')

  try {
    // Create a Bedrock embedding model
    const embeddingModel = await bedrockModels.titanEmbedText()
    
    // Create an agent with a Bedrock embedding model
    // Note: For embeddings, we don't need a full conversation model
    const agent = new Agent({
      name: 'Bedrock Embeddings Agent',
      systemPrompt: 'You are an embedding agent.',
      model: embeddingModel, // Using Amazon Titan Embed Text V1
      temperature: 0
    })

    // Example texts to embed
    const texts = [
      'The quick brown fox jumps over the lazy dog.',
      'A fast brown fox leaps over a sleepy dog.',
      'Machine learning is a subset of artificial intelligence.',
      'Deep learning uses neural networks to solve complex problems.',
      'The weather today is sunny and warm.'
    ]

    console.log('📝 Input texts:')
    texts.forEach((text, i) => console.log(`${i + 1}. ${text}`))
    console.log()

    // Generate embeddings for all texts
    console.log('🔄 Generating embeddings...')
    const result: EmbeddingsResult = await agent.generateEmbeddings(texts, {
      dimensions: 1536 // Titan Embed Text V1 supports up to 1536 dimensions
    })

    console.log(`✅ Generated ${result.embeddings.length} embeddings`)
    console.log(`📏 Embedding dimensions: ${result.embeddings[0].dimensions}`)
    
    if (result.usage) {
      console.log(`💰 Token usage: ${result.usage.inputTokens} input, ${result.usage.totalTokens} total`)
    }
    console.log()

    // Calculate similarity matrix
    console.log('🔍 Similarity Analysis:')
    console.log('======================')
    
    const embeddings = result.embeddings.map(e => e.embedding)
    
    // Compare first two texts (should be similar)
    const similarity1 = cosineSimilarity(embeddings[0], embeddings[1])
    console.log(`Similarity between texts 1 & 2 (similar): ${similarity1.toFixed(4)}`)
    
    // Compare texts about ML/AI (should be similar)
    const similarity2 = cosineSimilarity(embeddings[2], embeddings[3])
    console.log(`Similarity between texts 3 & 4 (ML/AI): ${similarity2.toFixed(4)}`)
    
    // Compare unrelated texts (should be less similar)
    const similarity3 = cosineSimilarity(embeddings[0], embeddings[4])
    console.log(`Similarity between texts 1 & 5 (unrelated): ${similarity3.toFixed(4)}`)
    console.log()

    // Find most similar pairs
    console.log('🎯 Most Similar Text Pairs:')
    console.log('===========================')
    
    const similarities: Array<{ i: number, j: number, similarity: number }> = []
    
    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        const sim = cosineSimilarity(embeddings[i], embeddings[j])
        similarities.push({ i, j, similarity: sim })
      }
    }
    
    // Sort by similarity (highest first)
    similarities.sort((a, b) => b.similarity - a.similarity)
    
    // Show top 3 most similar pairs
    similarities.slice(0, 3).forEach((pair, index) => {
      console.log(`${index + 1}. Text ${pair.i + 1} & Text ${pair.j + 1}: ${pair.similarity.toFixed(4)}`)
      console.log(`   "${texts[pair.i]}"`)
      console.log(`   "${texts[pair.j]}"`)
      console.log()
    })

    // Example of single text embedding
    console.log('🔍 Single Text Embedding Example:')
    console.log('=================================')
    
    const singleText = "What is the capital of France?"
    const singleResult = await agent.generateEmbeddings(singleText)
    
    console.log(`Text: "${singleText}"`)
    console.log(`Embedding dimensions: ${singleResult.embeddings[0].dimensions}`)
    console.log(`First 5 values: [${singleResult.embeddings[0].embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`)
    
    if (singleResult.usage) {
      console.log(`Token usage: ${singleResult.usage.inputTokens} input tokens`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    
    if (error instanceof Error && error.message.includes('@ai-sdk/amazon-bedrock')) {
      console.log('\n💡 To run this example:')
      console.log('   npm install @ai-sdk/amazon-bedrock')
      console.log('\n💡 Set up AWS credentials:')
      console.log('   export AWS_ACCESS_KEY_ID=your_access_key')
      console.log('   export AWS_SECRET_ACCESS_KEY=your_secret_key')
      console.log('   export AWS_REGION=us-east-1')
    }
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  runEmbeddingsExample()
}

export { runEmbeddingsExample }

#!/usr/bin/env tsx

/**
 * Image Generation Example
 * 
 * This example demonstrates how to use the Agent class for image generation
 * using DALL-E models through the AI SDK.
 */

import { openAIModels } from '../src/index.js'
import { experimental_generateImage } from 'ai'

async function main() {
  console.log('🎨 AI Library - Image Generation Example')
  console.log('=' .repeat(50))

  try {
    // Use DALL-E 3 model directly
    const dalleModel = openAIModels.dalle3()
    console.log('🤖 Model: DALL-E 3')
    console.log()

    // Test 1: Simple image generation
    console.log('🎨 Test 1: Simple Image Generation')
    console.log('Prompt: "A serene mountain landscape at sunset"')
    
    const result1 = await experimental_generateImage({
      model: dalleModel,
      prompt: 'A serene mountain landscape at sunset',
      size: '1024x1024'
    })

    console.log('✅ Generated', result1.images.length, 'image(s)')
    result1.images.forEach((img: any, index: number) => {
      console.log(`   Image ${index + 1}:`)
      if (img.url) console.log(`     URL: ${img.url}`)
      if (img.revisedPrompt) {
        console.log(`     Revised Prompt: ${img.revisedPrompt}`)
      }
    })
    console.log()

    // Test 2: Multiple images with different size
    console.log('🎨 Test 2: Multiple Images')
    console.log('Prompt: "A cute robot playing with colorful blocks"')
    
    const result2 = await experimental_generateImage({
      model: dalleModel,
      prompt: 'A cute robot playing with colorful blocks',
      size: '1792x1024',
      n: 2
    })

    console.log('✅ Generated', result2.images.length, 'image(s)')
    result2.images.forEach((img: any, index: number) => {
      console.log(`   Image ${index + 1}:`)
      if (img.url) console.log(`     URL: ${img.url}`)
      if (img.revisedPrompt) {
        console.log(`     Revised Prompt: ${img.revisedPrompt}`)
      }
    })
    console.log()

    // Test 3: With seed for reproducibility
    console.log('🎨 Test 3: Reproducible Generation (with seed)')
    console.log('Prompt: "Abstract geometric patterns in blue and gold"')
    
    const result3 = await experimental_generateImage({
      model: dalleModel,
      prompt: 'Abstract geometric patterns in blue and gold',
      size: '1024x1024',
      seed: 12345
    })

    console.log('✅ Generated', result3.images.length, 'image(s)')
    result3.images.forEach((img: any, index: number) => {
      console.log(`   Image ${index + 1}:`)
      if (img.url) console.log(`     URL: ${img.url}`)
      if (img.seed) console.log(`     Seed: ${img.seed}`)
      if (img.revisedPrompt) {
        console.log(`     Revised Prompt: ${img.revisedPrompt}`)
      }
    })

    console.log()
    console.log('✅ All image generation tests completed successfully!')

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error))
    
    if (error instanceof Error && error.message.includes('API key')) {
      console.log()
      console.log('💡 Make sure you have set your OPENAI_API_KEY environment variable:')
      console.log('   export OPENAI_API_KEY="your-api-key-here"')
    }
    
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

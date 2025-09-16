/**
 * Example: Generating images using AWS Bedrock
 * 
 * This example demonstrates how to:
 * 1. Set up a Bedrock image generation model
 * 2. Generate images using the Agent class
 * 3. Handle different image generation models (Titan, Stability AI)
 * 
 * Prerequisites:
 * - Install: npm install @ai-sdk/amazon-bedrock
 * - Set AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)
 * - Or use IAM roles if running on AWS
 */

import { Agent, bedrockModels, type ImageGenerationResult } from '../src/index.js'
import { writeFileSync } from 'fs'
import { join, basename } from 'path'

async function saveImage(base64Data: string, filename: string): Promise<void> {
  try {
    // Remove data URL prefix if present
    const base64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')
    
    // Sanitize filename to prevent path traversal attacks
    // Use basename to strip any directory path components and only keep the filename
    const sanitizedFilename = basename(filename).replace(/[^a-zA-Z0-9.-]/g, '_')
    
    // Ensure the filename has a valid extension
    const finalFilename = sanitizedFilename.endsWith('.png') ? sanitizedFilename : `${sanitizedFilename}.png`
    
    const outputPath = join(process.cwd(), finalFilename)
    writeFileSync(outputPath, buffer)
    console.log(`💾 Image saved to: ${outputPath}`)
  } catch (error) {
    console.error('❌ Error saving image:', error)
  }
}

async function runTitanImageExample() {
  console.log('🎨 Amazon Titan Image Generator Example')
  console.log('=======================================')

  try {
    // Create an agent with Titan Image Generator
    const model = await bedrockModels.titanImage()
    const agent = new Agent({
      name: 'Titan Image Agent',
      systemPrompt: 'You are an image generation agent.',
      model: model,
      temperature: 0
    })

    const prompt = "A serene mountain landscape at sunset, featuring majestic peaks reflected in a crystal-clear lake, with vibrant orange and pink clouds in the sky"
    
    console.log(`📝 Prompt: "${prompt}"`)
    console.log('🔄 Generating image with Amazon Titan...')

    const result: ImageGenerationResult = await agent.generateImage({
      prompt,
      n: 1,
      size: '1024x1024'
    })

    console.log(`✅ Generated ${result.images.length} image(s)`)
    
    result.images.forEach((image, index) => {
      console.log(`\n🖼️  Image ${index + 1}:`)
      
      if (image.url) {
        console.log(`   URL: ${image.url}`)
      }
      
      if (image.base64) {
        console.log(`   Base64 length: ${image.base64.length} characters`)
        // Save the image
        saveImage(image.base64, `titan-image-${index + 1}.png`)
      }
      
      if (image.metadata) {
        console.log(`   Metadata:`, image.metadata)
      }
    })

    if (result.metadata) {
      console.log('\n📊 Generation metadata:', result.metadata)
    }

  } catch (error) {
    console.error('❌ Error with Titan Image Generator:', error)
  }
}

async function runMultipleImagesExample() {
  console.log('\n🎨 Multiple Images Example')
  console.log('==========================')

  try {
    const model = await bedrockModels.titanImage()
    const agent = new Agent({
      name: 'Multi Image Agent',
      systemPrompt: 'You are an image generation agent.',
      model: model,
      temperature: 0
    })

    const prompts = [
      "A peaceful zen garden with raked sand and carefully placed stones",
      "A magical forest with glowing mushrooms and fairy lights",
      "A modern minimalist living room with natural lighting"
    ]

    for (const [index, prompt] of prompts.entries()) {
      console.log(`\n🔄 Generating image ${index + 1}/3...`)
      console.log(`📝 Prompt: "${prompt}"`)

      try {
        const result: ImageGenerationResult = await agent.generateImage({
          prompt,
          n: 1,
          size: '512x512' // Smaller size for faster generation
        })

        if (result.images[0]?.base64) {
          await saveImage(result.images[0].base64, `multi-image-${index + 1}.png`)
        }

        console.log(`✅ Image ${index + 1} completed`)
      } catch (error) {
        console.error(`❌ Error generating image ${index + 1}:`, error)
      }
    }

  } catch (error) {
    console.error('❌ Error in multiple images example:', error)
  }
}

async function runBedrockImageExample() {
  console.log('🚀 AWS Bedrock Image Generation Examples')
  console.log('========================================')

  try {
    // Run all examples
    await runTitanImageExample()
    await runMultipleImagesExample()

    console.log('\n🎉 All examples completed!')
    console.log('\n💡 Generated images have been saved to the current directory')

  } catch (error) {
    console.error('❌ Error:', error)
    
    if (error instanceof Error && error.message.includes('@ai-sdk/amazon-bedrock')) {
      console.log('\n💡 To run this example:')
      console.log('   npm install @ai-sdk/amazon-bedrock')
      console.log('\n💡 Set up AWS credentials:')
      console.log('   export AWS_ACCESS_KEY_ID=your_access_key')
      console.log('   export AWS_SECRET_ACCESS_KEY=your_secret_key')
      console.log('   export AWS_REGION=us-east-1')
      console.log('\n💡 Make sure you have access to Bedrock image generation models in your AWS account')
    }
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  runBedrockImageExample()
}

export { runBedrockImageExample, runTitanImageExample, runMultipleImagesExample }

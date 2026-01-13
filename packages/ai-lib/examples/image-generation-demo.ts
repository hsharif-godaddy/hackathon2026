/**
 * Image Generation Example with Gemini 2.5 Flash Image
 *
 * This example demonstrates:
 * - Generating images using Gemini 2.5 Flash Image model
 * - Using AI SDK 6's experimental_generateImage API
 * - Customizing image size and aspect ratio
 * - Saving generated images to disk
 */

import 'dotenv/config'
import { generateImageWithModel } from '../src/utils/image-generation.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
  console.log('🎨 Image Generation Example with Gemini 2.5 Flash Image\n')

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found. Please set your API key.')
    console.log('💡 For Google Gemini: Get your API key from https://aistudio.google.com/app/apikey')
    console.log('💡 For proxy/custom endpoint: Set OPENAI_BASE_URL to your proxy endpoint')
    process.exit(1)
  }
  
  if (process.env.OPENAI_BASE_URL) {
    console.log(`🔗 Using custom endpoint: ${process.env.OPENAI_BASE_URL}\n`)
  }

  const outputDir = path.join(__dirname, 'output')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  try {
    // ==========================================
    // DEMO 1: Basic Image Generation
    // ==========================================
    console.log('='.repeat(61))
    console.log('DEMO 1: Basic Image Generation')
    console.log('='.repeat(61))

    const prompt1 = 'A serene landscape with mountains at sunset, vibrant colors, digital art style'
    console.log(`\n📝 Prompt: "${prompt1}"`)
    console.log('🎨 Generating image...\n')

    const result1 = await generateImageWithModel({
      prompt: prompt1,
      n: 1
    })

    const filename1 = 'landscape-sunset.png'
    const filepath1 = path.join(outputDir, filename1)
    const imageBuffer1 = Buffer.from(result1.image, 'base64')
    fs.writeFileSync(filepath1, imageBuffer1)

    console.log(`✅ Image generated successfully!`)
    console.log(`📁 Saved to: ${filepath1}`)
    console.log(`📊 Size: ${imageBuffer1.length} bytes`)

    // ==========================================
    // DEMO 2: Custom Size Image Generation
    // ==========================================
    console.log('\n\n' + '='.repeat(61))
    console.log('DEMO 2: Custom Size Image Generation')
    console.log('='.repeat(61))

    const prompt2 = 'A futuristic city with flying cars, neon lights, cyberpunk style'
    console.log(`\n📝 Prompt: "${prompt2}"`)
    console.log('📐 Size: 1024x1024')
    console.log('🎨 Generating image...\n')

    const result2 = await generateImageWithModel({
      prompt: prompt2,
      size: '1024x1024',
      n: 1
    })

    const filename2 = 'futuristic-city.png'
    const filepath2 = path.join(outputDir, filename2)
    const imageBuffer2 = Buffer.from(result2.image, 'base64')
    fs.writeFileSync(filepath2, imageBuffer2)

    console.log(`✅ Image generated successfully!`)
    console.log(`📁 Saved to: ${filepath2}`)
    console.log(`📊 Size: ${imageBuffer2.length} bytes`)

    // ==========================================
    // DEMO 3: Custom Aspect Ratio
    // ==========================================
    console.log('\n\n' + '='.repeat(61))
    console.log('DEMO 3: Custom Aspect Ratio')
    console.log('='.repeat(61))

    const prompt3 = 'A wide panoramic view of an alien planet with two moons, space art'
    console.log(`\n📝 Prompt: "${prompt3}"`)
    console.log('📐 Aspect Ratio: 16:9')
    console.log('🎨 Generating image...\n')

    const result3 = await generateImageWithModel({
      prompt: prompt3,
      aspectRatio: '16:9',
      n: 1
    })

    const filename3 = 'alien-planet-panoramic.png'
    const filepath3 = path.join(outputDir, filename3)
    const imageBuffer3 = Buffer.from(result3.image, 'base64')
    fs.writeFileSync(filepath3, imageBuffer3)

    console.log(`✅ Image generated successfully!`)
    console.log(`📁 Saved to: ${filepath3}`)
    console.log(`📊 Size: ${imageBuffer3.length} bytes`)

    // ==========================================
    // DEMO 4: Portrait Aspect Ratio
    // ==========================================
    console.log('\n\n' + '='.repeat(61))
    console.log('DEMO 4: Portrait Aspect Ratio')
    console.log('='.repeat(61))

    const prompt4 = 'A mystical wizard with a long beard, holding a glowing staff, fantasy art'
    console.log(`\n📝 Prompt: "${prompt4}"`)
    console.log('📐 Aspect Ratio: 3:4 (Portrait)')
    console.log('🎨 Generating image...\n')

    const result4 = await generateImageWithModel({
      prompt: prompt4,
      aspectRatio: '3:4',
      n: 1
    })

    const filename4 = 'wizard-portrait.png'
    const filepath4 = path.join(outputDir, filename4)
    const imageBuffer4 = Buffer.from(result4.image, 'base64')
    fs.writeFileSync(filepath4, imageBuffer4)

    console.log(`✅ Image generated successfully!`)
    console.log(`📁 Saved to: ${filepath4}`)
    console.log(`📊 Size: ${imageBuffer4.length} bytes`)

    // ==========================================
    // SUMMARY
    // ==========================================
    console.log('\n\n' + '='.repeat(61))
    console.log('DEMO COMPLETE - SUMMARY')
    console.log('='.repeat(61))

    const totalSize = imageBuffer1.length + imageBuffer2.length + imageBuffer3.length + imageBuffer4.length
    const totalImages = 4

    console.log(`\n📊 Generated ${totalImages} images`)
    console.log(`📁 Output directory: ${outputDir}`)
    console.log(`💾 Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)
    console.log(`🎨 Model: gemini-2.5-flash-image`)

    console.log('\n✅ Image Generation Demo Complete!')
    console.log('\n💡 Features demonstrated:')
    console.log('   ✓ Basic image generation from text prompts')
    console.log('   ✓ Custom image sizes (1024x1024)')
    console.log('   ✓ Custom aspect ratios (16:9, 3:4)')
    console.log('   ✓ Saving generated images to disk')
    console.log('   ✓ Using AI SDK 6 with Gemini 2.5 Flash Image')

    console.log('\n📸 Generated images:')
    console.log(`   1. ${filename1} - Landscape sunset`)
    console.log(`   2. ${filename2} - Futuristic city`)
    console.log(`   3. ${filename3} - Alien planet panoramic`)
    console.log(`   4. ${filename4} - Wizard portrait`)

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))

    if (error instanceof Error) {
      if (error.message.includes('API key') || error.message.includes('401')) {
        console.error('💡 Tip: Make sure OPENAI_API_KEY is properly set')
        console.error('💡 Get your API key from: https://aistudio.google.com/app/apikey')
      } else if (error.message.includes('fetch') || error.message.includes('network')) {
        console.error('💡 Tip: Check your network connection')
      } else if (error.message.includes('model')) {
        console.error('💡 Tip: Ensure gemini-2.5-flash-image model is available in your region')
      }
    }

    process.exit(1)
  }
}

main().catch(console.error)

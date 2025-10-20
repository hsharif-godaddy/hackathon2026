/**
 * Image Vision API Demo with Claude Sonnet 4
 *
 * This example demonstrates:
 * - Using image-content-builder utilities for vision API
 * - Processing local image files with file-processor
 * - Building multi-modal messages (text + images)
 * - Streaming responses from Claude Sonnet 4 with vision
 */

import 'dotenv/config'
import { getModel } from '../src/providers/unified-provider.js'
import { createAgentFactory } from '../src/core/agent-factory.js'
import { processFile, createFileInput } from '../src/utils/file-processor.js'
import {
  buildVisionMessage,
  buildHybridContent,
  isVisionCompatibleImage
} from '../src/utils/image-content-builder.js'
import { existsSync } from 'fs'
import { join } from 'path'

function getSampleImagePath(): string {
  const imagePath = join(process.cwd(), 'sample-images', 'sample-chart.png')

  if (!existsSync(imagePath)) {
    throw new Error(`Sample chart not found at: ${imagePath}\nPlease ensure sample-chart.png exists in the sample-images directory.`)
  }

  console.log(`📊 Using sample chart at: ${imagePath}`)
  return imagePath
}

async function main() {
  console.log('🚀 Image Vision API Demo with Claude Sonnet 4\n')

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not found in environment')
    console.log('Please set ANTHROPIC_API_KEY in your .env file')
    process.exit(1)
  }

  // Control which demo to run via DEMO environment variable (default: all)
  // Usage: DEMO=1 npx tsx examples/image-vision-demo.ts
  const demoToRun = process.env.DEMO ? parseInt(process.env.DEMO) : null

  if (demoToRun && ![1, 2, 3].includes(demoToRun)) {
    console.error('❌ Invalid DEMO value. Use DEMO=1, DEMO=2, or DEMO=3')
    process.exit(1)
  }

  if (demoToRun) {
    console.log(`📌 Running Demo ${demoToRun} only (set via DEMO environment variable)\n`)
  }

  try {
    console.log('📁 Loading sample image...')
    const imagePath = getSampleImagePath()

    console.log('\n🔧 Processing image file...')
    const fileInput = createFileInput(imagePath)
    const processedFile = await processFile(fileInput)

    console.log(`✅ Processed: ${processedFile.metadata.filename}`)
    console.log(`   Type: ${processedFile.metadata.mimeType}`)
    console.log(`   Size: ${processedFile.metadata.size} bytes`)
    console.log(`   Vision compatible: ${isVisionCompatibleImage(processedFile) ? '✅ Yes' : '❌ No'}`)

    if (!isVisionCompatibleImage(processedFile)) {
      console.log('\n⚠️  Note: File is not vision-compatible')
      console.log('Vision API supports: JPEG, PNG, GIF, WebP')
      console.log('Continuing with text-only mode...\n')
    } else {
      console.log(`   Base64 size: ${processedFile.base64Content?.length || 0} characters\n`)
    }

    console.log('\n🤖 Creating Claude Sonnet 4 agent...')
    const model = await getModel('claude4')

    const agentFactory = createAgentFactory()

    const agents = agentFactory.defineAgents({
      imageAnalyst: {
        name: 'Image Analysis Agent',
        system: `You are an expert at analyzing charts, graphs, and visual data.
When analyzing images, provide detailed insights about:
- The type of visualization
- Key metrics and trends
- Notable patterns or anomalies
- Actionable recommendations

Be thorough and precise in your analysis.`,
        model,
        visionEnabled: true,
        maxSteps: 1,
        temperature: 0.3,
        maxOutputTokens: 2000
      }
    })

    const agent = agents.get('imageAnalyst')

    console.log('✅ Agent created\n')

    let result1, result2, finalResult

    if (!demoToRun || demoToRun === 1) {
    console.log('=' + '='.repeat(80))
    console.log('DEMO 1: Single Image Analysis with Vision Message Builder')
    console.log('=' + '='.repeat(80) + '\n')

    const prompt1 = 'Analyze this chart and provide key insights about the quarterly performance trends.'

    console.log(`📝 User prompt: "${prompt1}"\n`)
    console.log('🔄 Passing image through context.files...')

    console.log(`✅ Context structure:`)
    console.log(`   Files: ${[processedFile].length}`)
    console.log(`   - ${processedFile.metadata.filename} (${processedFile.metadata.mimeType})`)
    console.log(`   - Vision compatible: ${isVisionCompatibleImage(processedFile) ? 'Yes' : 'No'}`)

    console.log('\n🤖 Claude Sonnet 4 Response:\n')

    result1 = await agent.generate(prompt1, {
      files: [processedFile]
    })
    console.log(result1.content)

    console.log(`\n📊 Token Usage:`)
    console.log(`   Input tokens: ${result1.usage?.inputTokens || 0}`)
    console.log(`   Output tokens: ${result1.usage?.outputTokens || 0}`)
    console.log(`   Total tokens: ${result1.usage?.totalTokens || 0}`)
    }

    if (!demoToRun || demoToRun === 2) {
    console.log('\n\n' + '=' + '='.repeat(80))
    console.log('DEMO 2: Hybrid Content (Text + Image Metadata)')
    console.log('=' + '='.repeat(80) + '\n')

    const prompt2 = 'What insights can you provide about the data visualization?'

    console.log(`📝 User prompt: "${prompt2}"\n`)
    console.log('🔄 Building hybrid content message...')

    const hybridMessage = buildHybridContent(prompt2, [processedFile])

    console.log(`✅ Hybrid message structure:`)
    console.log(`   Role: ${hybridMessage.role}`)
    console.log(`   Content type: ${typeof hybridMessage.content === 'string' ? 'string (with file metadata)' : 'multi-modal array'}`)

    console.log('\n🤖 Claude Sonnet 4 Response:\n')

    result2 = await agent.generate(prompt2, {
      files: [processedFile]
    })
    console.log(result2.content)

    console.log(`\n📊 Token Usage:`)
    console.log(`   Input tokens: ${result2.usage?.inputTokens || 0}`)
    console.log(`   Output tokens: ${result2.usage?.outputTokens || 0}`)
    console.log(`   Total tokens: ${result2.usage?.totalTokens || 0}`)
    }

    if (!demoToRun || demoToRun === 3) {
    console.log('\n\n' + '=' + '='.repeat(80))
    console.log('DEMO 3: Streaming with Vision Content')
    console.log('=' + '='.repeat(80) + '\n')

    const prompt3 = 'Provide a brief summary of the quarterly trends shown in the chart.'

    console.log(`📝 User prompt: "${prompt3}"\n`)
    console.log('🤖 Claude Sonnet 4 Streaming Response:\n')

    const streamResult = await agent.streamGenerate(prompt3, {
      files: [processedFile]
    })

    for await (const chunk of streamResult.textStream) {
      process.stdout.write(chunk)
    }

    finalResult = await streamResult.getFinalResult()

    console.log('\n\n📊 Final Token Usage:')
    console.log(`   Input tokens: ${finalResult.usage?.inputTokens || 0}`)
    console.log(`   Output tokens: ${finalResult.usage?.outputTokens || 0}`)
    console.log(`   Total tokens: ${finalResult.usage?.totalTokens || 0}`)
    }

    if (!demoToRun) {
    console.log('\n\n' + '=' + '='.repeat(80))
    console.log('SUMMARY')
    console.log('=' + '='.repeat(80))

    const totalTokens = (result1.usage?.totalTokens || 0) + (result2.usage?.totalTokens || 0) + (finalResult.usage?.totalTokens || 0)

    console.log('\n✅ Image Vision Demo Complete!')
    console.log(`\n📊 Total Usage:`)
    console.log(`   Total tokens used: ${totalTokens}`)
    console.log(`   Estimated cost: $${(totalTokens / 1000 * 0.003).toFixed(4)} (Claude Sonnet 4)`)
    console.log('\n✅ All three demos completed successfully!')

    console.log('\n💡 Key Takeaways:')
    console.log('   • buildVisionMessage() creates properly formatted vision API messages')
    console.log('   • buildHybridContent() handles mixed content types intelligently')
    console.log('   • isVisionCompatibleImage() checks if files can use vision API')
    console.log('   • Supports JPEG, PNG, GIF, WebP image formats')
    console.log('   • Seamlessly works with Claude Sonnet 4 vision capabilities')

    console.log('\n📁 Sample image location: ./sample-images/sample-chart.png')
    console.log('   (PNG format - fully compatible with Claude vision API)')
    }

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:', error.stack)
    }
    process.exit(1)
  }
}

main().catch(console.error)

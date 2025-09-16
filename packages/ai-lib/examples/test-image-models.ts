/**
 * Test actual image generation with available models
 * This will show which models you can actually use for image generation
 */

import { Agent, bedrockModels } from '../src/index.js'

interface ModelTest {
  name: string
  modelKey: keyof typeof bedrockModels
  success: boolean
  error?: string
  imageGenerated?: boolean
}

async function testImageGeneration(name: string, modelKey: keyof typeof bedrockModels): Promise<ModelTest> {
  try {
    console.log(`🧪 Testing ${name}...`)
    
    const model = await bedrockModels[modelKey]()
    const agent = new Agent({
      name: 'Test Agent',
      systemPrompt: 'You generate images.',
      model: model,
      temperature: 0
    })

    const result = await agent.generateImage({
      prompt: 'A simple red circle on white background',
      n: 1,
      size: '512x512'
    })

    if (result.images && result.images.length > 0) {
      console.log(`✅ ${name} - Image generation successful`)
      return {
        name,
        modelKey,
        success: true,
        imageGenerated: true
      }
    } else {
      console.log(`❌ ${name} - No images returned`)
      return {
        name,
        modelKey,
        success: false,
        error: 'No images returned'
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.log(`❌ ${name} - Failed: ${errorMsg}`)
    return {
      name,
      modelKey,
      success: false,
      error: errorMsg
    }
  }
}

async function testAllModels() {
  console.log('🎨 Testing Bedrock Image Generation Models')
  console.log('=========================================\n')

  const modelsToTest = [
    { name: 'Amazon Titan Image v1', key: 'titanImage' as const },
    { name: 'Amazon Titan Image v2', key: 'titanImageV2' as const },
    { name: 'Stability SD 3.5', key: 'stabilitySD35' as const },
    { name: 'Stability Core v1.1', key: 'stabilityCore' as const },
    { name: 'Stability Ultra v1.1', key: 'stabilityUltra' as const },
  ]

  const results: ModelTest[] = []

  for (const { name, key } of modelsToTest) {
    const result = await testImageGeneration(name, key)
    results.push(result)
    console.log() // Add spacing
  }

  // Summary
  console.log('📊 Results Summary')
  console.log('==================')
  
  const working = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  console.log(`✅ Working models (${working.length}):`)
  working.forEach(r => console.log(`   - ${r.name}`))
  
  console.log(`❌ Failed models (${failed.length}):`)
  failed.forEach(r => {
    console.log(`   - ${r.name}`)
    if (r.error) {
      console.log(`     Error: ${r.error.includes('access') ? 'No model access - enable in Bedrock console' : r.error}`)
    }
  })

  if (working.length > 0) {
    console.log('\n💡 You can use these models successfully:')
    working.forEach(r => {
      console.log(`   bedrockModels.${r.modelKey}()`)
    })
  }

  if (failed.some(r => r.error?.includes('access'))) {
    console.log('\n🔧 To enable failed models:')
    console.log('1. Go to AWS Bedrock Console: https://console.aws.amazon.com/bedrock/')
    console.log('2. Navigate to "Model access" → "Manage model access"')
    console.log('3. Enable the models showing access errors')
    console.log('4. Submit request and wait for approval')
  }
}

// Run tests
if (import.meta.url === `file://${process.argv[1]}`) {
  testAllModels().catch(console.error)
}

export { testAllModels }
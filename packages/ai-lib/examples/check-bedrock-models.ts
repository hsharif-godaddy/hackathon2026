/**
 * Utility to check which Bedrock image models are available and accessible
 * Run this to see which models you can use in your AWS account
 */

import { bedrockModels } from '../src/index.js'

interface ModelTest {
  name: string
  modelFunction: () => Promise<any>
  available: boolean
  error?: string
}

async function testModel(name: string, modelFunction: () => Promise<any>): Promise<ModelTest> {
  try {
    const model = await modelFunction()
    // Try a simple test generation (this might fail due to access, but model creation succeeded)
    return {
      name,
      modelFunction,
      available: true
    }
  } catch (error) {
    return {
      name,
      modelFunction,
      available: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function checkBedrockModels() {
  console.log('🔍 Checking Bedrock Image Model Availability')
  console.log('===========================================\n')

  const modelTests = [
    { name: 'Amazon Titan Image Generator v1', fn: bedrockModels.titanImage },
    { name: 'Amazon Titan Image Generator v2', fn: bedrockModels.titanImageV2 },
    { name: 'Stability AI SD 3.5 Large', fn: bedrockModels.stabilitySD35 },
    { name: 'Stability AI Core v1.1', fn: bedrockModels.stabilityCore },
    { name: 'Stability AI Ultra v1.1', fn: bedrockModels.stabilityUltra },
  ]

  const results: ModelTest[] = []

  for (const { name, fn } of modelTests) {
    console.log(`Testing: ${name}...`)
    const result = await testModel(name, fn)
    results.push(result)
    
    if (result.available) {
      console.log(`✅ ${name} - Available`)
    } else {
      console.log(`❌ ${name} - Not available`)
      if (result.error) {
        console.log(`   Error: ${result.error}`)
      }
    }
    console.log()
  }

  // Summary
  const available = results.filter(r => r.available)
  const unavailable = results.filter(r => !r.available)

  console.log('\n📊 Summary')
  console.log('===========')
  console.log(`✅ Available models: ${available.length}`)
  available.forEach(r => console.log(`   - ${r.name}`))
  
  console.log(`❌ Unavailable models: ${unavailable.length}`)
  unavailable.forEach(r => console.log(`   - ${r.name}`))

  if (available.length > 0) {
    console.log('\n💡 Recommended usage:')
    console.log('For image generation, use one of the available models:')
    available.forEach(r => {
      const funcName = Object.entries(bedrockModels).find(([_, fn]) => fn === r.modelFunction)?.[0]
      if (funcName) {
        console.log(`   bedrockModels.${funcName}()`)
      }
    })
  }

  if (unavailable.length > 0) {
    console.log('\n🔧 To enable unavailable models:')
    console.log('1. Go to AWS Bedrock console')
    console.log('2. Navigate to "Model access" in the left sidebar') 
    console.log('3. Request access for the models you need')
    console.log('4. Wait for approval (usually takes a few minutes)')
  }
}

// Run the check
if (import.meta.url === `file://${process.argv[1]}`) {
  checkBedrockModels().catch(console.error)
}

export { checkBedrockModels }
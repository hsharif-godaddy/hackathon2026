#!/usr/bin/env tsx

import { getModel, getModelInfo } from '../src/providers/unified-provider.js'

/**
 * Demo of Claude proxy routing functionality
 * 
 * This example shows how Claude models are automatically routed through
 * the OpenAI proxy when AWS credentials are not available but OPENAI_BASE_URL is set.
 */

async function demonstrateClaudeProxy() {
  console.log('🔄 Claude Proxy Routing Demo\n')

  // Test different scenarios
  const scenarios = [
    {
      name: 'No AWS, with OpenAI proxy',
      description: 'Should route Claude through OpenAI proxy',
      config: {
        openaiBaseUrl: 'https://proxy.example.com'
      },
      // Simulate no AWS credentials by not setting them
      clearAWS: true
    },
    {
      name: 'With AWS profile',
      description: 'Should use Bedrock directly',
      config: {
        awsProfile: 'test-profile',
        openaiBaseUrl: 'https://proxy.example.com'
      },
      clearAWS: false
    },
    {
      name: 'With AWS credentials',
      description: 'Should use Bedrock directly',
      config: {
        awsAccessKeyId: 'test-key',
        awsSecretAccessKey: 'test-secret',
        awsRegion: 'us-west-2',
        openaiBaseUrl: 'https://proxy.example.com'
      },
      clearAWS: false
    },
    {
      name: 'No AWS, no proxy',
      description: 'Should fail with validation error',
      config: {},
      clearAWS: true,
      expectError: true
    }
  ]

  for (const scenario of scenarios) {
    console.log(`📋 Scenario: ${scenario.name}`)
    console.log(`   ${scenario.description}`)
    
    // Temporarily clear AWS environment variables if needed
    const originalAWSVars: Record<string, string | undefined> = {}
    if (scenario.clearAWS) {
      const awsVars = [
        'AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 
        'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_SESSION_TOKEN',
        'AWS_ROLE_ARN', 'AWS_WEB_IDENTITY_TOKEN_FILE'
      ]
      
      for (const varName of awsVars) {
        originalAWSVars[varName] = process.env[varName]
        delete process.env[varName]
      }
    }

    try {
      // Get model info to see routing decision
      const modelInfo = getModelInfo('claude-sonnet-4-6', scenario.config)
      console.log(`   📊 Model Info:`)
      console.log(`      Provider: ${modelInfo.provider}`)
      console.log(`      Full Name: ${modelInfo.fullName}`)
      console.log(`      Using Proxy: ${modelInfo.usingProxy}`)
      if (modelInfo.proxyReason) {
        console.log(`      Proxy Reason: ${modelInfo.proxyReason}`)
      }

      if (!scenario.expectError) {
        // Try to create the model (this will validate configuration)
        try {
          await getModel('claude-sonnet-4-6', scenario.config)
          console.log(`   ✅ Model creation would succeed`)
        } catch (error) {
          console.log(`   ❌ Model creation failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

    } catch (error) {
      if (scenario.expectError) {
        console.log(`   ✅ Expected error: ${error instanceof Error ? error.message : String(error)}`)
      } else {
        console.log(`   ❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Restore AWS environment variables
    if (scenario.clearAWS) {
      for (const [varName, value] of Object.entries(originalAWSVars)) {
        if (value !== undefined) {
          process.env[varName] = value
        }
      }
    }

    console.log()
  }
}

async function demonstrateModelList() {
  console.log('📋 Claude Models Available for Proxy Routing:')
  
  const claudeModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'azure/claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5']
  
  for (const modelName of claudeModels) {
    const info = getModelInfo(modelName)
    console.log(`   ${modelName} → ${info.fullName}`)
  }
  
  console.log()
}

async function main() {
  console.log('🚀 Claude Proxy Routing Demo\n')
  
  try {
    await demonstrateModelList()
    await demonstrateClaudeProxy()
    
    console.log('✅ Demo completed successfully!')
    
  } catch (error) {
    console.error('❌ Demo failed:', error)
    process.exit(1)
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

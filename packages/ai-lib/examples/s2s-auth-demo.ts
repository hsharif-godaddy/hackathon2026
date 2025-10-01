#!/usr/bin/env node

/**
 * S2S Authentication Demo
 * 
 * This example demonstrates how to use Service-to-Service (S2S) authentication
 * with ai-lib using gd-auth-client and AWS IAM credentials.
 * 
 * Prerequisites:
 * 1. Set GOCODE_USE_S2S_AUTH=true to enable S2S authentication
 * 2. Configure AWS credentials (via AWS CLI, environment variables, or IAM role)
 * 3. Ensure you have access to the appropriate SSO endpoint
 * 
 * Environment-based Configuration (based on NODE_ENV):
 * 
 * SSO Hosts:
 * - NODE_ENV=dev (default): sso.dev-godaddy.com
 * - NODE_ENV=test: sso.test-godaddy.com  
 * - NODE_ENV=production: sso.godaddy.com
 * 
 * GoCode Endpoints:
 * - NODE_ENV=dev (default): https://api.gocode.caas.dev-gdcorp.tools
 * - NODE_ENV=test: https://api.gocode.caas.test-gdcorp.tools
 * - NODE_ENV=production: https://api.gocode.caas.gdcorp.tools
 * 
 * Environment Variable Overrides:
 * - OPENAI_BASE_URL: Override GoCode endpoint for all environments
 * 
 * Usage:
 *   GOCODE_USE_S2S_AUTH=true npm run example:s2s-auth
 *   NODE_ENV=test GOCODE_USE_S2S_AUTH=true npm run example:s2s-auth
 *   NODE_ENV=production GOCODE_USE_S2S_AUTH=true npm run example:s2s-auth
 */

import { getModel, isS2SAuthEnabled, getS2SToken, getS2SProviderConfig, getDefaultSsoHost, getDefaultGoCodeEndpoint } from '../src/index.js'
import { generateText } from 'ai'

// AWS SDK imports for debugging identity
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'

/**
 * Debug function to show current AWS identity
 */
async function showAwsIdentity() {
  console.log('🔍 AWS Identity Debug Information')
  console.log('-'.repeat(40))
  
  try {
    // Get credentials from the default provider chain
    const credentialProvider = fromNodeProviderChain()
    const credentials = await credentialProvider()
    
    console.log('✅ AWS Credentials found:')
    console.log(`   Access Key ID: ${credentials.accessKeyId.substring(0, 10)}...`)
    if (credentials.sessionToken) {
      console.log(`   Session Token: ${credentials.sessionToken.substring(0, 20)}...`)
      console.log('   Type: Temporary credentials (likely SSO/AssumeRole)')
    } else {
      console.log('   Type: Long-term credentials')
    }
    
    // Get caller identity using STS
    const stsClient = new STSClient({
      credentials: credentialProvider,
      region: process.env.AWS_REGION || 'us-west-2'
    })
    
    const identityCommand = new GetCallerIdentityCommand({})
    const identity = await stsClient.send(identityCommand)
    
    console.log('✅ AWS Identity:')
    console.log(`   Account: ${identity.Account}`)
    console.log(`   User/Role ARN: ${identity.Arn}`)
    console.log(`   User ID: ${identity.UserId}`)
    
    // Extract useful info from ARN
    if (identity.Arn) {
      const arnParts = identity.Arn.split('/')
      const roleOrUser = arnParts[arnParts.length - 1]
      console.log(`   Identity Name: ${roleOrUser}`)
      
      if (identity.Arn.includes('assumed-role')) {
        console.log('   🔐 Using IAM Role (good for S2S auth)')
      } else if (identity.Arn.includes('user')) {
        console.log('   👤 Using IAM User')
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to get AWS identity:', error instanceof Error ? error.message : String(error))
    console.log('')
    console.log('Common issues:')
    console.log('- No AWS credentials configured')
    console.log('- Expired SSO session (run "aws sso login")')
    console.log('- Invalid or expired access keys')
    console.log('- No internet connection to AWS STS')
    return false
  }
  
  return true
}

async function demonstrateS2SAuth() {
  console.log('🔧 S2S Authentication Demo')
  console.log('=' .repeat(40))
  
  // Check if S2S authentication is enabled
  const s2sEnabled = isS2SAuthEnabled()
  console.log(`S2S Authentication Enabled: ${s2sEnabled}`)
  console.log(`Current NODE_ENV: ${process.env.NODE_ENV || 'dev'}`)
  console.log(`Default SSO Host: ${getDefaultSsoHost()}`)
  console.log(`Default GoCode Endpoint: ${getDefaultGoCodeEndpoint()}`)
  
  // Show environment override if set
  if (process.env.OPENAI_BASE_URL) {
    console.log(`GoCode Endpoint Override (OPENAI_BASE_URL): ${process.env.OPENAI_BASE_URL}`)
  }
  
  // Always show AWS identity for debugging
  console.log('')
  const awsIdentityValid = await showAwsIdentity()

  if (!s2sEnabled) {
    console.log('')
    console.log('⚠️  S2S authentication is not enabled.')
    console.log('To enable it, set the environment variable:')
    console.log('   GOCODE_USE_S2S_AUTH=true')
    console.log('')
    if (!awsIdentityValid) {
      console.log('You also need to configure AWS credentials:')
      console.log('   - Run `aws configure` to set up credentials')
      console.log('   - Or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY')
      console.log('   - Or use an IAM role with appropriate permissions')
    } else {
      console.log('✅ AWS credentials are configured and valid.')
      console.log('Once you enable S2S auth, it should work with these credentials.')
    }
    console.log('')
    process.exit(1)
  }

  if (!awsIdentityValid) {
    console.log('')
    console.log('❌ AWS credentials are required for S2S authentication.')
    process.exit(1)
  }

  try {
    console.log('')
    console.log('🔐 Testing S2S Configuration...')
    
    // Test S2S configuration retrieval using environment-based defaults
    const s2sProviderConfig = await getS2SProviderConfig({
      // ssoHost will default to environment-appropriate value
      // You can override it if needed: ssoHost: 'sso.test-godaddy.com'
      region: 'us-west-2'
    })
    
    if (s2sProviderConfig) {
      console.log(`✅ Successfully configured S2S authentication`)
      console.log(`   GoCode Endpoint: ${s2sProviderConfig.baseURL}`)
      console.log(`   Authorization: Bearer ${s2sProviderConfig.headers.Authorization.substring(7, 57)}...`)
    } else {
      console.log('❌ S2S configuration returned null (should not happen when enabled)')
      process.exit(1)
    }
    
  } catch (error) {
    console.error('❌ Failed to configure S2S authentication:', error instanceof Error ? error.message : String(error))
    console.log('')
    console.log('Common issues:')
    console.log('- AWS credentials not configured properly')
    console.log('- No access to the SSO service')
    console.log('- Network connectivity issues')
    process.exit(1)
  }

  try {
    console.log('')
    console.log('🤖 Testing AI Model with S2S Authentication...')
    
    // Get a model that will use S2S authentication
    // The getModel function will automatically use S2S auth when enabled
    // It will use GoCode endpoint with Bearer token authentication
    const model = await getModel('gpt-4o-mini', {
      // S2S config uses environment-based defaults
      // Override only if needed for specific environments
      s2sAuth: {
        region: 'us-west-2'
        // ssoHost automatically selected based on NODE_ENV
        // goCodeEndpoint uses default GoCode endpoint
      }
    })
    
    console.log('✅ Successfully created model with S2S authentication')
    
    // Test a simple generation
    console.log('🔄 Generating text...')
    const result = await generateText({
      model,
      prompt: 'Say "Hello from S2S authenticated AI!" in a creative way.',
      maxTokens: 100
    })
    
    console.log('✅ Generated text:', result.text)
    console.log('')
    console.log('🎉 S2S Authentication is working correctly!')
    
  } catch (error) {
    console.error('❌ Failed to use model with S2S auth:', error instanceof Error ? error.message : String(error))
    console.log('')
    console.log('This could indicate:')
    console.log('- The retrieved JWT token is invalid or expired')
    console.log('- The OpenAI API endpoint doesn\'t accept the JWT')
    console.log('- Network or configuration issues')
    process.exit(1)
  }
}

// Test scenarios without S2S authentication
async function demonstrateRegularAuth() {
  console.log('')
  console.log('📝 Comparison: Regular Authentication')
  console.log('=' .repeat(40))
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️  OPENAI_API_KEY not set - skipping regular auth demo')
    return
  }
  
  try {
    // Temporarily disable S2S auth for comparison
    const originalS2S = process.env.GOCODE_USE_S2S_AUTH
    process.env.GOCODE_USE_S2S_AUTH = 'false'
    
    const model = await getModel('gpt-4o-mini')
    console.log('✅ Successfully created model with regular API key authentication')
    
    const result = await generateText({
      model,
      prompt: 'Say "Hello from regular API key authentication!" briefly.',
      maxTokens: 50
    })
    
    console.log('✅ Generated text:', result.text)
    
    // Restore original S2S setting
    if (originalS2S) {
      process.env.GOCODE_USE_S2S_AUTH = originalS2S
    }
    
  } catch (error) {
    console.error('❌ Regular auth failed:', error instanceof Error ? error.message : String(error))
  }
}

// Main demo function
async function main() {
  console.log('🚀 AI-Lib S2S Authentication Demo')
  console.log('')
  
  try {
    await demonstrateS2SAuth()
    await demonstrateRegularAuth()
    
    console.log('')
    console.log('✨ Demo completed successfully!')
    
  } catch (error) {
    console.error('💥 Demo failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error)
    process.exit(1)
  })
}

export { main as s2sAuthDemo }
/**
 * Basic AWS Bedrock Claude Usage Example
 * 
 * Demonstrates simple AI generation using AWS Bedrock with Claude models.
 * 
 * Prerequisites:
 * 1. AWS CLI configured OR AWS credentials in environment
 * 2. Set AWS_REGION in your .env file (e.g., us-west-2)
 * 3. AWS account with Bedrock access and Claude models enabled
 * 
 * Authentication options:
 * - AWS CLI: `aws configure` or `aws configure sso`
 * - Environment: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 * - Profile: AWS_PROFILE=your-profile-name
 */

import 'dotenv/config'
import { Agent } from '../src/index.js'
import { bedrockModels, createBedrockProvider, getBedrockStatus } from '../src/providers/bedrock.js'

async function main() {
  console.log('🚀 AWS Bedrock Claude Basic Usage Example\n')

  try {
    // Check Bedrock status
    console.log('🔍 Checking AWS Bedrock configuration...')
    const status = await getBedrockStatus()
    
    console.log('📊 Status:')
    console.log(`   Configured: ${status.isConfigured ? '✅' : '❌'}`)
    console.log(`   Credentials: ${status.hasCredentials ? '✅' : '❌'}`)
    if (status.profile) {
      console.log(`   Profile: ${status.profile}`)
    }
    if (status.region) {
      console.log(`   Region: ${status.region}`)
    }
    console.log()

    if (!status.isConfigured || !status.hasCredentials) {
      console.error('❌ AWS Bedrock not properly configured')
      console.log('💡 Setup options:')
      console.log('   1. AWS CLI: aws configure')
      console.log('   2. Environment: Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION')
      console.log('   3. Profile: Set AWS_PROFILE=your-profile-name')
      process.exit(1)
    }

    // Create Bedrock provider
    createBedrockProvider()
    console.log('✅ AWS Bedrock provider configured')
    
    // Create a simple agent using Claude Sonnet 4
    const agent = new Agent({
      name: 'Code Assistant',
      systemPrompt: 'You are an expert software developer and helpful coding assistant. Provide clear, concise explanations and high-quality code examples.',
      model: bedrockModels.claudeSonnet4(),
      temperature: 0.3,
      maxTokens: 1000
    })

    console.log(`💻 Agent: ${agent.getConfig().name}`)
    console.log(`🧠 Model: Claude Sonnet 4`)
    console.log(`🌡️ Temperature: 0.3\n`)

    // Example 1: Code explanation
    console.log('📚 Example 1: Code Explanation')
    const codePrompt = `Explain this JavaScript function and suggest improvements:

function processUsers(users) {
  var result = [];
  for (var i = 0; i < users.length; i++) {
    if (users[i].active == true) {
      result.push({
        id: users[i].id,
        name: users[i].name.toUpperCase(),
        email: users[i].email
      });
    }
  }
  return result;
}`
    
    console.log(`User: ${codePrompt}`)
    console.log('\nClaude:')
    
    const result = await agent.generate(codePrompt)
    console.log(result.content)
    
    // Show usage stats
    if (result.usage) {
      console.log(`\n📊 Usage: ${result.usage.inputTokens} input + ${result.usage.outputTokens} output = ${result.usage.totalTokens} total tokens`)
    }

    console.log('\n' + '='.repeat(80) + '\n')

    // Example 2: Algorithm question
    console.log('🧮 Example 2: Algorithm Design')
    const algorithmPrompt = "Write a Python function to find the longest palindromic substring in a string. Include time complexity analysis."
    
    console.log(`User: ${algorithmPrompt}`)
    console.log('\nClaude:')
    
    const result2 = await agent.generate(algorithmPrompt)
    console.log(result2.content)
    
    if (result2.usage) {
      console.log(`\n📊 Usage: ${result2.usage.inputTokens} input + ${result2.usage.outputTokens} output = ${result2.usage.totalTokens} total tokens`)
    }

    console.log('\n✨ Bedrock Claude example completed successfully!')

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error))
    
    if (error instanceof Error && error.message.includes('credentials')) {
      console.log('\n💡 AWS Credentials Help:')
      console.log('   1. Check AWS CLI: aws sts get-caller-identity')
      console.log('   2. Configure: aws configure')
      console.log('   3. Or use profile: AWS_PROFILE=your-profile npm run example:bedrock')
    }
    
    process.exit(1)
  }
}

main().catch(console.error)

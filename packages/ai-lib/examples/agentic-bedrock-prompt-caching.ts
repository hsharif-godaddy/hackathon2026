/**
 * Agentic Bedrock with Prompt Caching Example
 * 
 * This example demonstrates:
 * - Prompt caching with ExperimentalAgentFactory to reduce costs
 * - Large system prompts cached across multiple requests
 * - Cost comparison between cached and non-cached requests
 * - Agentic behavior with cached contexts
 */

import 'dotenv/config'
import { getModel } from '../src/providers/unified-provider.js'
import { createTool } from '../src/tools/base-tool.js'
import { createExperimentalAgentFactory } from '../src/core/agent-factory-experimental.js'
import { z } from 'zod'

// Large, detailed system prompt that benefits from caching (2000+ tokens)
const LARGE_SYSTEM_PROMPT = `You are an expert software architect and AI engineering consultant specializing in building production-grade AI applications. You have deep expertise in:

## Technical Expertise
- **AI/ML Frameworks**: LangChain, LlamaIndex, Hugging Face, OpenAI SDK, Anthropic SDK
- **Languages**: TypeScript, Python, JavaScript, Go, Rust
- **Cloud Platforms**: AWS (Bedrock, Lambda, ECS), Azure (OpenAI Service), GCP (Vertex AI)
- **Databases**: Vector databases (Pinecone, Weaviate, Chroma), PostgreSQL, MongoDB, Redis
- **Infrastructure**: Docker, Kubernetes, Terraform, CDK, Serverless Framework

## AI Application Architecture Patterns
1. **RAG (Retrieval Augmented Generation)**
   - Vector store integration and similarity search
   - Document chunking and embedding strategies
   - Context window optimization
   - Hybrid search combining semantic and keyword search

2. **Agentic AI Systems**
   - Tool calling and function execution
   - Multi-step reasoning and planning
   - State management across agent interactions
   - Error handling and retry mechanisms

3. **Production AI Patterns**
   - Prompt engineering and optimization
   - Cost monitoring and token usage tracking
   - Caching strategies for improved performance
   - Rate limiting and queue management
   - Model fallback and reliability patterns

## Code Review Guidelines for AI Applications

### Performance Optimization
- Implement prompt caching for frequently used system prompts
- Use streaming responses for better user experience
- Optimize vector search with proper indexing
- Implement context compression for large documents
- Cache expensive operations (embeddings, API calls)

### Cost Management
- Monitor token usage and implement budgets
- Use appropriate model sizes for different tasks
- Implement intelligent retries with exponential backoff
- Cache results when possible to avoid redundant API calls
- Use cheaper models for simple tasks, premium models for complex reasoning

### Security Best Practices
- Sanitize user inputs before processing
- Implement proper authentication and authorization
- Use environment variables for API keys and secrets
- Validate and limit file uploads
- Implement rate limiting to prevent abuse
- Audit AI outputs for sensitive information

### Error Handling
- Implement graceful degradation when AI services are unavailable
- Handle token limit exceeded errors with context truncation
- Provide meaningful error messages to users
- Log detailed error information for debugging
- Implement circuit breakers for external AI services

### Testing Strategies
- Unit test prompt templates and validation logic
- Integration tests for AI service interactions
- End-to-end tests for complete user workflows
- Performance tests for response times and throughput
- Cost tests to monitor unexpected expenses

### Monitoring and Observability
- Track AI model performance metrics
- Monitor token usage and costs
- Log AI interactions for analysis and improvement
- Implement alerting for service degradation
- Track user satisfaction with AI outputs

When reviewing code or providing guidance, always consider:
- Scalability and performance implications
- Cost optimization opportunities
- Security and privacy concerns
- User experience and reliability
- Maintainability and debugging ease

Provide specific, actionable recommendations with code examples where helpful. Consider the full software development lifecycle from development to production deployment.`

// Code analysis tool
const codeAnalysisTool = createTool(
  'Analyze code for best practices and improvements',
  z.object({
    code: z.string().describe('Code to analyze'),
    language: z.string().describe('Programming language of the code'),
    focus: z.string().describe('Specific areas to focus on: security, performance, maintainability, etc.').optional()
  }),
  async ({ code, language, focus = 'general' }) => {
    console.log(`🔍 [Code Analysis Tool] Analyzing ${language} code (focus: ${focus})...`)
    
    // Simulate code analysis
    const issues = []
    const suggestions = []
    
    // Basic analysis patterns
    if (code.includes('var ') && language === 'javascript') {
      issues.push({
        type: 'modernization',
        severity: 'medium',
        line: code.split('\n').findIndex(line => line.includes('var ')) + 1,
        message: 'Use const/let instead of var for better scoping'
      })
    }
    
    if (code.includes('==') && !code.includes('===') && language === 'javascript') {
      issues.push({
        type: 'equality',
        severity: 'high',
        message: 'Use strict equality (===) instead of loose equality (==)'
      })
    }
    
    if (code.includes('eval(') && language === 'javascript') {
      issues.push({
        type: 'security',
        severity: 'critical',
        message: 'Avoid eval() - it poses security risks and performance issues'
      })
    }
    
    // Generate suggestions based on focus
    if (focus === 'performance') {
      suggestions.push('Consider using memoization for expensive computations')
      suggestions.push('Implement lazy loading for large datasets')
    } else if (focus === 'security') {
      suggestions.push('Validate and sanitize all user inputs')
      suggestions.push('Use parameterized queries to prevent SQL injection')
    }
    
    const result = {
      language,
      linesAnalyzed: code.split('\n').length,
      issues,
      suggestions,
      overallScore: Math.max(10 - issues.length * 2, 1),
      focus,
      analyzedAt: new Date().toISOString()
    }
    
    console.log(`✅ [Code Analysis Tool] Found ${issues.length} issues, score: ${result.overallScore}/10`)
    return result
  }
)

// Architecture review tool
const architectureReviewTool = createTool(
  'Review system architecture and provide recommendations',
  z.object({
    systemDescription: z.string().describe('Description of the system architecture'),
    scale: z.string().describe('Expected scale: small, medium, large, enterprise'),
    primaryConcerns: z.string().describe('Main concerns: performance, cost, security, maintainability, etc.')
  }),
  async ({ systemDescription, scale, primaryConcerns }) => {
    console.log(`🏗️  [Architecture Review Tool] Reviewing ${scale} scale system (concerns: ${primaryConcerns})...`)
    
    const recommendations = []
    const patterns = []
    const technologies = []
    
    // Generate recommendations based on scale and concerns
    if (scale === 'large' || scale === 'enterprise') {
      recommendations.push('Implement microservices architecture for better scalability')
      recommendations.push('Use container orchestration (Kubernetes) for deployment')
      patterns.push('API Gateway pattern for service routing')
      patterns.push('Circuit Breaker pattern for resilience')
    }
    
    if (primaryConcerns.includes('performance')) {
      recommendations.push('Implement caching layers (Redis, CDN)')
      recommendations.push('Use database indexing and query optimization')
      technologies.push('Redis for caching')
      technologies.push('Elasticsearch for search')
    }
    
    if (primaryConcerns.includes('security')) {
      recommendations.push('Implement OAuth 2.0 / JWT for authentication')
      recommendations.push('Use HTTPS everywhere and implement CORS properly')
      patterns.push('Zero Trust Architecture')
    }
    
    const result = {
      systemDescription,
      scale,
      primaryConcerns,
      recommendations,
      suggestedPatterns: patterns,
      recommendedTechnologies: technologies,
      estimatedComplexity: scale === 'small' ? 'Low' : scale === 'medium' ? 'Medium' : 'High',
      reviewedAt: new Date().toISOString()
    }
    
    console.log(`✅ [Architecture Review Tool] Generated ${recommendations.length} recommendations`)
    return result
  }
)

async function runCachedExample(agent: any, prompt: string, label: string) {
  console.log(`\n${label}`)
  console.log('-'.repeat(60))
  console.log(`👤 User: ${prompt}\n`)
  console.log('🤖 Assistant: ')
  
  // For the cached agent, pass the large system prompt as a cached context message
  const streamResult = await agent.streamGenerate(prompt, {
    context: agent.getName().includes('Cached') ? [{
      role: 'user',
      content: LARGE_SYSTEM_PROMPT,
      cachePoint: { type: 'ephemeral' }
    }] : undefined
  })
  let content = ''
  
  const startTime = Date.now()
  for await (const chunk of streamResult.textStream) {
    process.stdout.write(chunk)
    content += chunk
  }
  const responseTime = Date.now() - startTime
  
  const finalResult = await streamResult.getFinalResult()
  
  console.log(`\n\n📊 Results:`)
  console.log(`   Response time: ${responseTime}ms`)
  console.log(`   Content length: ${content.length} characters`)
  console.log(`   Usage: ${finalResult.usage?.totalTokens} tokens`)
  console.log(`   Input tokens: ${finalResult.usage?.inputTokens}`)
  console.log(`   Output tokens: ${finalResult.usage?.outputTokens}`)
  console.log(`   Cached input tokens: ${finalResult.usage?.cachedInputTokens || 0}`)
  console.log(`   Tools used: ${finalResult.toolCalls?.length || 0}`)
  
  if (finalResult.usage) {
    const cost = (finalResult.usage.inputTokens / 1000 * 0.003) + (finalResult.usage.outputTokens / 1000 * 0.015)
    const cachedCost = ((finalResult.usage.inputTokens - (finalResult.usage.cachedInputTokens || 0)) / 1000 * 0.003) + 
                      ((finalResult.usage.cachedInputTokens || 0) / 1000 * 0.0003) + // Cached tokens cost much less
                      (finalResult.usage.outputTokens / 1000 * 0.015)
    
    console.log(`   Estimated cost (no caching): $${cost.toFixed(4)}`)
    if (finalResult.usage.cachedInputTokens) {
      console.log(`   Estimated cost (with caching): $${cachedCost.toFixed(4)}`)
      console.log(`   Savings from caching: $${(cost - cachedCost).toFixed(4)} (${((cost - cachedCost) / cost * 100).toFixed(1)}%)`)
    }
  }
  
  return {
    responseTime,
    usage: finalResult.usage,
    toolCalls: finalResult.toolCalls,
    content
  }
}

async function runCachedExampleWithContext(agent: any, prompt: string, label: string) {
  console.log(`\n${label}`)
  console.log('-'.repeat(60))
  console.log(`👤 User: ${prompt}\n`)
  console.log('🤖 Assistant: ')
  
  // Demonstrate context with cachePoint - include the large system prompt + additional context
  const streamResult = await agent.streamGenerate(prompt, {
    context: [
      {
        role: 'user',
        content: LARGE_SYSTEM_PROMPT,
        cachePoint: { type: 'ephemeral' }
      },
      {
        role: 'user',
        content: 'ADDITIONAL CONTEXT: This is a follow-up architecture review. Consider enterprise-grade solutions and modern cloud-native patterns.',
        cachePoint: { type: 'ephemeral' }
      }
    ]
  })
  let content = ''
  
  const startTime = Date.now()
  for await (const chunk of streamResult.textStream) {
    process.stdout.write(chunk)
    content += chunk
  }
  
  const finalResult = await streamResult.getFinalResult()
  const responseTime = Date.now() - startTime
  
  console.log(`\n\n⏱️  Response time: ${responseTime}ms`)
  console.log(`💾 Context: Included cached context message`)
  
  if (finalResult.usage) {
    console.log(`📊 Token usage:`)
    console.log(`   Input tokens: ${finalResult.usage.inputTokens}`)
    console.log(`   Output tokens: ${finalResult.usage.outputTokens}`)
    console.log(`   Total tokens: ${finalResult.usage.totalTokens}`)
    if (finalResult.usage.cachedInputTokens) {
      console.log(`   🎯 Cached input tokens: ${finalResult.usage.cachedInputTokens}`)
    }
    
    const cost = (finalResult.usage.inputTokens / 1000 * 0.003) + (finalResult.usage.outputTokens / 1000 * 0.015)
    const cachedCost = ((finalResult.usage.inputTokens - (finalResult.usage.cachedInputTokens || 0)) / 1000 * 0.003) + 
                      ((finalResult.usage.cachedInputTokens || 0) / 1000 * 0.0003) + // Cached tokens cost much less
                      (finalResult.usage.outputTokens / 1000 * 0.015)
    
    console.log(`   Estimated cost (no caching): $${cost.toFixed(4)}`)
    if (finalResult.usage.cachedInputTokens) {
      console.log(`   Estimated cost (with caching): $${cachedCost.toFixed(4)}`)
      console.log(`   Savings from caching: $${(cost - cachedCost).toFixed(4)} (${((cost - cachedCost) / cost * 100).toFixed(1)}%)`)
    }
  }
  
  return {
    responseTime,
    usage: finalResult.usage,
    toolCalls: finalResult.toolCalls,
    content
  }
}

async function main() {
  console.log('🚀 Agentic Bedrock with Prompt Caching Example\n')

  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
    console.error('❌ AWS credentials not found.')
    process.exit(1)
  }

  try {
    console.log('🔗 Connecting to AWS Bedrock...')
    const model = await getModel('claude4')
    
    console.log('🏭 Creating agents with and without caching...')
    
    const agentFactory = createExperimentalAgentFactory()

    // Create agents with different caching configurations
    const agents = agentFactory.defineAgents({
      // Agent with prompt caching (via context messages)
      cachedAgent: {
        name: 'Cached AI Architect',
        system: 'You are an AI architect. You will receive detailed system context as a cached message.',
        model,
        tools: {
          codeAnalysis: codeAnalysisTool,
          architectureReview: architectureReviewTool
        },
        maxSteps: 6,
        stopAfterTools: ['codeAnalysis', 'architectureReview'],
        temperature: 0.3,
        maxOutputTokens: 2000
      },
      
      // Agent without caching for comparison
      nonCachedAgent: {
        name: 'Non-Cached AI Architect',
        system: LARGE_SYSTEM_PROMPT,
        model,
        tools: {
          codeAnalysis: codeAnalysisTool,
          architectureReview: architectureReviewTool
        },
        maxSteps: 6,
        stopAfterTools: ['codeAnalysis', 'architectureReview'],
        temperature: 0.3,
        maxOutputTokens: 2000
        // No caching configuration
      }
    })

    const cachedAgent = agents.get('cachedAgent')
    const nonCachedAgent = agents.get('nonCachedAgent')
    
    console.log(`✅ Created agents with large system prompt (${LARGE_SYSTEM_PROMPT.length} characters)\n`)

    console.log('=' + '='.repeat(80))
    console.log('PROMPT CACHING DEMONSTRATION')
    console.log('=' + '='.repeat(80))

    // Sample code for analysis
    const sampleCode = `
function processUserData(userData) {
    var result = {};
    
    if (userData.email == null) {
        throw new Error("Email required");
    }
    
    if (userData.password.length < 8) {
        result.error = "Password too short";
        return result;
    }
    
    // Store password in plain text (bad!)
    result.password = userData.password;
    result.email = userData.email.toLowerCase();
    
    return result;
}
`

    // ==========================================
    // FIRST REQUEST (No caching benefit yet)
    // ==========================================
    console.log('\n🔄 FIRST REQUEST - Establishing Cache')
    
    const result1 = await runCachedExample(
      cachedAgent,
      `Please analyze this JavaScript code for security and best practices issues:\n\n${sampleCode}`,
      '📄 Code Analysis Request #1 (Cached Agent)'
    )

    // ==========================================
    // SECOND REQUEST (Should benefit from caching)
    // ==========================================
    const result2 = await runCachedExampleWithContext(
      cachedAgent,
      "Now please review the architecture for a medium-scale e-commerce platform that needs to handle 10,000 daily users with focus on security and performance.",
      '\n🔄 SECOND REQUEST - Cache Hit Expected\n📄 Architecture Review Request (Cached Agent)'
    )

    // ==========================================
    // COMPARISON: Non-cached agent
    // ==========================================
    const result3 = await runCachedExample(
      nonCachedAgent,
      "Review the architecture for a medium-scale e-commerce platform that needs to handle 10,000 daily users with focus on security and performance.",
      '\n🔄 COMPARISON REQUEST - No Caching\n📄 Architecture Review Request (Non-Cached Agent)'
    )

    // ==========================================
    // THIRD REQUEST (More caching benefits)
    // ==========================================
    const result4 = await runCachedExample(
      cachedAgent,
      `Can you analyze this improved version of the code and compare it to the previous version?\n\n${sampleCode.replace('var result', 'const result').replace('==', '===').replace('// Store password in plain text (bad!)\n    result.password = userData.password;', '// Hash password before storing\n    result.passwordHash = hashPassword(userData.password);')}`,
      '\n🔄 THIRD REQUEST - More Cache Benefits\n📄 Improved Code Analysis (Cached Agent)'
    )

    // ==========================================
    // PERFORMANCE AND COST ANALYSIS
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(80))
    console.log('CACHING PERFORMANCE & COST ANALYSIS')
    console.log('=' + '='.repeat(80))

    const results = [result1, result2, result3, result4]
    const cachedResults = [result1, result2, result4] // Cached agent results
    const nonCachedResults = [result3] // Non-cached agent results

    console.log('\n📊 Performance Metrics:')
    console.log(`   Average response time (cached): ${Math.round(cachedResults.reduce((sum, r) => sum + r.responseTime, 0) / cachedResults.length)}ms`)
    console.log(`   Average response time (non-cached): ${Math.round(nonCachedResults.reduce((sum, r) => sum + r.responseTime, 0) / nonCachedResults.length)}ms`)

    const totalTokens = results.reduce((sum, r) => sum + (r.usage?.totalTokens || 0), 0)
    const totalCachedTokens = cachedResults.reduce((sum, r) => sum + (r.usage?.cachedInputTokens || 0), 0)
    const totalToolCalls = results.reduce((sum, r) => sum + (r.toolCalls?.length || 0), 0)

    console.log('\n💰 Cost Analysis:')
    console.log(`   Total tokens used: ${totalTokens}`)
    console.log(`   Total cached tokens: ${totalCachedTokens}`)
    console.log(`   Cache hit rate: ${totalCachedTokens > 0 ? ((totalCachedTokens / totalTokens) * 100).toFixed(1) : 0}%`)
    console.log(`   Total tool calls: ${totalToolCalls}`)

    if (totalTokens > 0) {
      const fullCost = (totalTokens / 1000) * 0.009 // Average cost
      const cachedCostSavings = (totalCachedTokens / 1000) * 0.0027 // 90% savings on cached tokens
      console.log(`   Estimated cost without caching: $${fullCost.toFixed(4)}`)
      console.log(`   Estimated savings from caching: $${cachedCostSavings.toFixed(4)}`)
      console.log(`   Total cost with caching: $${(fullCost - cachedCostSavings).toFixed(4)}`)
    }

    console.log('\n🎯 Caching Benefits Demonstrated:')
    console.log('   ✓ Reduced token costs for repeated system prompt usage')
    console.log('   ✓ Faster response times for subsequent requests')
    console.log('   ✓ Maintained full agentic capabilities with tools')
    console.log('   ✓ Significant cost savings for applications with large system prompts')
    console.log('   ✓ Seamless integration with ExperimentalAgentFactory')

    console.log('\n💡 Best Practices for Prompt Caching:')
    console.log('   • Use caching for large system prompts (>1000 tokens)')
    console.log('   • Cache stable content that doesn\'t change between requests')
    console.log('   • Monitor cache hit rates and adjust accordingly')
    console.log('   • Consider caching for high-volume applications')
    console.log('   • Balance between caching benefits and dynamic content needs')

    console.log('\n✅ Prompt Caching Demo Complete!')

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main().catch(console.error)

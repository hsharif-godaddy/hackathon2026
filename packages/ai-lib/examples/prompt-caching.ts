/**
 * Prompt Caching Example with AWS Bedrock
 * 
 * Demonstrates how to use prompt caching to reduce costs and improve performance
 * when using large system prompts repeatedly.
 * 
 * Prerequisites:
 * 1. AWS CLI configured OR AWS credentials in environment
 * 2. Set AWS_REGION in your .env file (e.g., us-west-2) 
 * 3. AWS account with Bedrock access and Claude models enabled
 */

import 'dotenv/config'
import { Agent } from '../src/index.js'
import { bedrockModels, getBedrockStatus } from '../src/providers/bedrock.js'
import { createCachingMessageBuilder } from '../src/core/message-builder.js'

// Large system prompt that benefits from caching (2500+ tokens)
const LARGE_SYSTEM_PROMPT = `You are an expert software architect and senior developer with deep expertise in multiple programming languages and frameworks. Your role is to provide comprehensive code reviews, suggest best practices, and help developers write better code.

## Your Expertise
- **Languages**: JavaScript/TypeScript, Python, Java, C#, Go, Rust, PHP, Swift, Kotlin
- **Frontend**: React, Vue.js, Angular, Svelte, Next.js, Nuxt.js
- **Backend**: Node.js, Express, Fastify, Django, Flask, Spring Boot, .NET Core
- **Databases**: PostgreSQL, MySQL, MongoDB, Redis, Elasticsearch
- **Cloud**: AWS, Azure, GCP, Docker, Kubernetes
- **DevOps**: CI/CD, GitHub Actions, Jenkins, Terraform

## Code Review Guidelines

### JavaScript/TypeScript Best Practices
1. **Use Modern Syntax**: Prefer const/let over var, arrow functions, destructuring
2. **Type Safety**: Always use TypeScript for large applications
3. **Error Handling**: Implement proper error boundaries and try-catch blocks
4. **Performance**: Avoid unnecessary re-renders, use useMemo/useCallback appropriately
5. **Security**: Validate inputs, sanitize data, use environment variables for secrets
6. **Testing**: Write unit tests, integration tests, and end-to-end tests
7. **Code Organization**: Use clear folder structure, separate concerns
8. **Naming**: Use descriptive variable and function names
9. **Documentation**: Write clear comments and JSDoc for complex functions
10. **Accessibility**: Ensure proper ARIA labels and semantic HTML

### React Specific Guidelines
- Use functional components with hooks instead of class components
- Implement proper key props for lists
- Use React.memo for expensive components
- Leverage custom hooks for reusable logic
- Follow the single responsibility principle for components
- Use proper state management (useState, useContext, Redux, Zustand)
- Implement proper loading and error states
- Use React.Suspense for code splitting
- Follow React patterns like render props and compound components

### Node.js Backend Guidelines
- Use async/await instead of callbacks
- Implement proper middleware for Express apps
- Use environment variables for configuration
- Implement proper logging with structured logs
- Use connection pooling for databases
- Implement proper validation with libraries like Joi or Zod
- Use proper authentication and authorization
- Implement rate limiting and request validation
- Use proper error handling middleware
- Follow RESTful API design principles

### Database Best Practices
- Use parameterized queries to prevent SQL injection
- Implement proper indexing strategies
- Use transactions for data consistency
- Implement connection pooling
- Use migrations for schema changes
- Optimize queries with EXPLAIN plans
- Implement proper backup strategies
- Use read replicas for scaling reads
- Monitor query performance
- Implement proper data validation

### Security Guidelines
- Never store sensitive data in client-side code
- Use HTTPS for all communications
- Implement proper CORS policies
- Use secure headers (helmet.js for Express)
- Validate and sanitize all inputs
- Use secure session management
- Implement proper password hashing (bcrypt, Argon2)
- Use JWT tokens securely with proper expiration
- Implement rate limiting
- Regular security audits and dependency updates

### Performance Optimization
- Implement proper caching strategies (Redis, CDN)
- Use code splitting and lazy loading
- Optimize bundle sizes with tree shaking
- Implement proper database indexing
- Use compression for API responses
- Optimize images and static assets
- Implement proper monitoring and alerting
- Use profiling tools to identify bottlenecks
- Implement graceful degradation
- Use service workers for PWAs

When reviewing code, always consider: readability, maintainability, performance, security, scalability, and testability. Provide specific, actionable feedback with examples when possible.`

async function main() {
  console.log('🔄 Prompt Caching Example - AWS Bedrock Claude\n')

  try {
    // Check Bedrock status
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
      process.exit(1)
    }

    // Create agents: one without caching, one with caching
    const agentWithoutCaching = new Agent({
      name: 'Code Reviewer (No Cache)',
      systemPrompt: LARGE_SYSTEM_PROMPT,
      model: bedrockModels.claudeSonnet4(),
      temperature: 0.1,
      maxTokens: 800
    })

    const agentWithCaching = new Agent({
      name: 'Code Reviewer (With Cache)',
      messageBuilder: createCachingMessageBuilder(LARGE_SYSTEM_PROMPT),
      model: bedrockModels.claudeSonnet4(),
      temperature: 0.1,
      maxTokens: 800
    })

    const testCode = `
function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price * items[i].quantity;
  }
  return total;
}`

    const reviewPrompt = `Please review this JavaScript function and provide specific improvement suggestions:\n\n${testCode}`

    console.log('📝 Code to Review:')
    console.log(testCode)
    console.log()

    // Test 1: Without caching (baseline)
    console.log('⏱️  Test 1: WITHOUT Caching (Baseline)')
    const startBaseline = Date.now()
    const resultBaseline = await agentWithoutCaching.generate(reviewPrompt)
    const timeBaseline = Date.now() - startBaseline

    console.log(`✅ Completed in ${timeBaseline}ms`)
    if (resultBaseline.usage) {
      console.log(`📊 Tokens: ${resultBaseline.usage.inputTokens} input + ${resultBaseline.usage.outputTokens} output = ${resultBaseline.usage.totalTokens} total`)
    }
    console.log()

    // Test 2: With caching (first request - builds cache)
    console.log('🔧 Test 2: WITH Caching (First request - builds cache)')
    const startCached1 = Date.now()
    const resultCached1 = await agentWithCaching.generate(reviewPrompt)
    const timeCached1 = Date.now() - startCached1

    console.log(`✅ Completed in ${timeCached1}ms`)
    if (resultCached1.usage) {
      console.log(`📊 Tokens: ${resultCached1.usage.inputTokens} input + ${resultCached1.usage.outputTokens} output = ${resultCached1.usage.totalTokens} total`)
      if (resultCached1.usage.cachedInputTokens !== undefined) {
        console.log(`💾 Cached: ${resultCached1.usage.cachedInputTokens} tokens`)
      }
    }
    if (resultCached1.caching) {
      console.log('🔄 Cache Info:')
      if (resultCached1.caching.cacheWriteInputTokens !== undefined) {
        console.log(`   Cache Writes: ${resultCached1.caching.cacheWriteInputTokens} tokens`)
      }
    }
    console.log()

    // Test 3: With caching (second request - uses cache)
    console.log('⚡ Test 3: WITH Caching (Second request - uses cache)')
    const modifiedPrompt = reviewPrompt + ' Focus on performance optimizations.'
    const startCached2 = Date.now()
    const resultCached2 = await agentWithCaching.generate(modifiedPrompt)
    const timeCached2 = Date.now() - startCached2

    console.log(`✅ Completed in ${timeCached2}ms`)
    if (resultCached2.usage) {
      console.log(`📊 Tokens: ${resultCached2.usage.inputTokens} input + ${resultCached2.usage.outputTokens} output = ${resultCached2.usage.totalTokens} total`)
      if (resultCached2.usage.cachedInputTokens !== undefined) {
        console.log(`💾 Cached: ${resultCached2.usage.cachedInputTokens} tokens`)
      }
    }
    if (resultCached2.caching) {
      console.log('🔄 Cache Info:')
      if (resultCached2.caching.cachedInputTokens !== undefined) {
        console.log(`   Cache Hits: ${resultCached2.caching.cachedInputTokens} tokens`)
      }
      if (resultCached2.caching.cacheHitRate !== undefined) {
        console.log(`   Hit Rate: ${(resultCached2.caching.cacheHitRate * 100).toFixed(1)}%`)
      }
    }
    console.log()

    // Performance comparison
    console.log('📈 Performance Summary:')
    console.log(`   Baseline (no cache): ${timeBaseline}ms`)
    console.log(`   With cache (build): ${timeCached1}ms`)
    console.log(`   With cache (hit): ${timeCached2}ms`)
    
    if (timeCached2 < timeBaseline) {
      const improvement = ((timeBaseline - timeCached2) / timeBaseline * 100).toFixed(1)
      console.log(`   ⚡ Cache benefit: ${improvement}% faster`)
    }

    // Token efficiency
    if (resultBaseline.usage && resultCached2.usage) {
      const tokenSavings = (resultBaseline.usage.inputTokens - (resultCached2.usage.inputTokens - (resultCached2.usage.cachedInputTokens || 0)))
      if (tokenSavings > 0) {
        console.log(`   💰 Token savings: ${tokenSavings} tokens per cached request`)
      }
    }

    console.log('\n✨ Prompt caching example completed!')
    console.log('\n💡 Key Benefits:')
    console.log('   • Reduced latency for repeated large prompts')
    console.log('   • Lower costs by not reprocessing cached content')
    console.log('   • Better user experience with faster responses')

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main().catch(console.error)

#!/usr/bin/env tsx

import { createPromptBuilder, pb, when, PromptContext } from '../src/prompt/prompt-builder.js'
import { writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'

/**
 * Demo of the PromptBuilder system
 */

async function createSampleFiles() {
  // Create sample directory and files for testing
  const samplesDir = resolve(process.cwd(), 'samples')
  
  try {
    await mkdir(samplesDir, { recursive: true })
  } catch (error) {
    // Directory might already exist
  }

  // Create sample system prompt files
  await writeFile(resolve(samplesDir, 'base-instructions.md'), `# AI Assistant Instructions

You are a helpful AI assistant with expertise in multiple domains. You should:

- Provide accurate, helpful information
- Be clear and concise in your responses
- Ask clarifying questions when needed
- Admit when you don't know something`)

  await writeFile(resolve(samplesDir, 'coding-expertise.md'), `## Coding Expertise

You have advanced knowledge in:
- Modern web development (React, TypeScript, Node.js)
- System architecture and design patterns
- Database design and optimization
- DevOps and deployment practices

When helping with code, always:
- Follow best practices and conventions
- Provide working, testable examples
- Explain your reasoning
- Suggest improvements and alternatives`)

  await writeFile(resolve(samplesDir, 'safety-guidelines.md'), `## Safety Guidelines

**IMPORTANT**: Always follow these safety guidelines:

- Never provide harmful, illegal, or unethical advice
- Protect user privacy and sensitive information
- Be respectful and inclusive in all interactions
- Decline requests for dangerous or inappropriate content
- Verify information when possible`)

  console.log('📁 Created sample files in ./samples/')
}

async function basicExample() {
  console.log('\n🔹 Basic Prompt Builder Example')
  console.log('=' + '='.repeat(50))

  const builder = createPromptBuilder()

  const prompt = await builder
    .text('Welcome! I am your AI assistant.')
    .text('\n## My Capabilities')
    .list([
      'Answer questions on various topics',
      'Help with coding and technical problems', 
      'Provide writing assistance',
      'Explain complex concepts'
    ], 'bullet')
    .text('\nHow can I help you today?')
    .build()

  console.log(prompt)
}

async function fileExample() {
  console.log('\n🔹 File-Based Prompt Example')
  console.log('=' + '='.repeat(50))

  await createSampleFiles()

  const builder = createPromptBuilder()

  const prompt = await builder
    .file('./samples/base-instructions.md')
    .file('./samples/coding-expertise.md')
    .file('./samples/safety-guidelines.md')
    .build()

  console.log(prompt)
}

async function conditionalExample() {
  console.log('\n🔹 Conditional Sections Example')
  console.log('=' + '='.repeat(50))

  const builder = createPromptBuilder()

  // Example context
  const context: PromptContext = {
    user: {
      name: 'John',
      role: 'developer',
      experience: 'senior',
      preferences: {
        codeStyle: 'functional',
        verbosity: 'detailed'
      }
    },
    config: {
      features: {
        codeReview: true,
        debugging: true,
        architecture: false
      }
    },
    env: {
      NODE_ENV: 'development'
    }
  }

  const prompt = await builder
    .text('Hello! I am your personalized AI assistant.')
    
    // Conditional greeting based on user
    .when(when.exists('user.name'))
      .template('\n## Welcome {{user.name}}!')
      .template('I see you are a {{user.experience}} {{user.role}}.')
    .end()
    
    // Conditional features based on config
    .when(when.equals('config.features.codeReview', true))
      .text('\n## Code Review')
      .text('I can help you review code for best practices, performance, and maintainability.')
    .end()
    
    .when(when.equals('config.features.debugging', true))
      .text('\n## Debugging Support')
      .text('I can assist with debugging issues and finding solutions to technical problems.')
    .end()
    
    .when(when.equals('config.features.architecture', true))
      .text('\n## Architecture Guidance')
      .text('I can provide advice on system architecture and design patterns.')
    .end()
    
    // Development-specific instructions
    .when(when.env('NODE_ENV', 'development'))
      .text('\n## Development Mode')
      .text('Development environment detected. I will provide detailed explanations and debugging information.')
    .end()
    
    .text('\nHow can I assist you today?')
    .build(context)

  console.log(prompt)
}

async function dynamicContentExample() {
  console.log('\n🔹 Dynamic Content Example')
  console.log('=' + '='.repeat(50))

  const builder = createPromptBuilder()

  const context: PromptContext = {
    user: {
      name: 'Alice',
      projects: ['web-app', 'mobile-app', 'api-service'],
      lastActive: new Date('2024-01-15')
    },
    config: {
      currentTime: new Date(),
      version: '2.1.0'
    }
  }

  const prompt = await builder
    .text('AI Assistant System Prompt')
    
    // Dynamic greeting with current time
    .text((ctx) => {
      const now = ctx.config?.currentTime as Date || new Date()
      const time = now.toLocaleTimeString()
      return `\nCurrent session started at: ${time}`
    })
    
    // Template with variable interpolation  
    .template('\n## User Profile\nName: {{user.name}}\nActive Projects: {{user.projects.length}}')
    
    // Dynamic project list
    .text('\n## Current Projects')
    .list((ctx) => {
      return (ctx.user?.projects as string[]) || []
    }, 'numbered')
    
    // Dynamic status based on last activity
    .text((ctx) => {
      const lastActive = new Date(ctx.user?.lastActive as string)
      const daysSinceActive = Math.floor((Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24))
      
      if (daysSinceActive === 0) {
        return '\n✅ User is actively engaged today'
      } else if (daysSinceActive <= 7) {
        return `\n⚠️  User was last active ${daysSinceActive} days ago`
      } else {
        return '\n❌ User has been inactive for over a week'
      }
    })
    
    .template('\nSystem Version: {{config.version}}')
    .build(context)

  console.log(prompt)
}

async function helperApiExample() {
  console.log('\n🔹 Helper API Example')
  console.log('=' + '='.repeat(50))

  await createSampleFiles()

  // Using the pb helper for more concise syntax
  const sections = [
    pb.text('System Prompt Builder - Helper API Demo'),
    pb.file('./samples/base-instructions.md'),
    
    // Conditional section using helper
    pb.when(
      when.env('NODE_ENV', 'development'),
      pb.text('\n## Development Mode Enabled'),
      pb.text('Extra debugging information will be provided.')
    ),
    
    // Conditional coding expertise
    pb.section(
      pb.file('./samples/coding-expertise.md'),
      when.exists('user.role') // Only include if user has a role
    ),
    
    pb.template('\nSession ID: {{sessionId}}'),
    
    pb.list([
      'Type "help" for assistance',
      'Type "quit" to exit',
      'Ask any question to get started'
    ], 'dash')
  ]

  const builder = createPromptBuilder()
  const prompt = await builder
    .sections(...sections)
    .build({
      user: { role: 'developer' },
      sessionId: 'sess_' + Math.random().toString(36).substring(7)
    })

  console.log(prompt)
}

async function complexConditionsExample() {
  console.log('\n🔹 Complex Conditions Example')
  console.log('=' + '='.repeat(50))

  const builder = createPromptBuilder()

  const context: PromptContext = {
    user: {
      type: 'premium',
      role: 'developer',
      experience: 'senior'
    },
    features: {
      advanced: true,
      beta: false
    }
  }

  const prompt = await builder
    .text('Advanced AI Assistant')
    
    // Complex AND condition
    .when(when.and(
      when.equals('user.type', 'premium'),
      when.equals('features.advanced', true)
    ))
      .text('\n🌟 Premium Features Enabled')
      .list([
        'Advanced code analysis',
        'Architecture recommendations',
        'Performance optimization tips'
      ])
    .end()
    
    // Complex OR condition
    .when(when.or(
      when.equals('user.experience', 'senior'),
      when.equals('user.role', 'lead')
    ))
      .text('\n👑 Expert-Level Assistance')
      .text('I will provide detailed technical insights and advanced concepts.')
    .end()
    
    // Negated condition
    .when(when.not(when.equals('features.beta', true)))
      .text('\n✅ Stable Release Mode')
      .text('You are using the stable version with tested features.')
    .end()
    
    .build(context)

  console.log(prompt)
}

async function errorHandlingExample() {
  console.log('\n🔹 Error Handling Example')
  console.log('=' + '='.repeat(50))

  const builder = createPromptBuilder()

  try {
    // This should fail because the file doesn't exist
    await builder
      .text('This will work')
      .file('./non-existent-file.md')
      .text('This will not be reached')
      .build()
  } catch (error) {
    console.log('❌ Expected error caught:', error instanceof Error ? error.message : String(error))
  }

  // Successful build after error
  const workingPrompt = await builder
    .clear() // Clear previous sections
    .text('Error handling works!')
    .text('Builder recovered successfully.')
    .build()

  console.log('\n✅ Recovered prompt:')
  console.log(workingPrompt)
}

async function main() {
  console.log('🚀 Prompt Builder Demo\n')

  try {
    await basicExample()
    await fileExample()
    await conditionalExample()
    await dynamicContentExample()
    await helperApiExample()
    await complexConditionsExample()
    await errorHandlingExample()
    
    console.log('\n✅ All examples completed successfully!')
    
  } catch (error) {
    console.error('❌ Demo failed:', error)
    process.exit(1)
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

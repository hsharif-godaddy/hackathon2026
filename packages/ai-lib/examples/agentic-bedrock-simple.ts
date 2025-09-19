/**
 * Simple Agentic Bedrock Example
 * 
 * This example demonstrates:
 * - Basic agentic behavior with tool usage
 * - Intelligent stop conditions
 * - Simple weather and recommendation tools
 * - Tool execution tracking
 */

import 'dotenv/config'
import { getModel } from '../src/providers/unified-provider.js'
import { createTool } from '../src/tools/base-tool.js'
import { createExperimentalAgentFactory } from '../src/core/agent-factory-experimental.js'
import { z } from 'zod'

// Simple weather tool
const weatherTool = createTool(
  'Get current weather information for a city',
  z.object({
    city: z.string().describe('City name to get weather for'),
    units: z.string().describe('Temperature units: celsius or fahrenheit').optional()
  }),
  async ({ city, units = 'celsius' }) => {
    console.log(`🌤️  [Weather Tool] Getting weather for ${city}...`)
    
    // Mock weather data for demo
    const weatherData: Record<string, any> = {
      'london': { temp: 15, condition: 'rainy', humidity: 78 },
      'tokyo': { temp: 28, condition: 'sunny', humidity: 55 },
      'new york': { temp: 22, condition: 'partly cloudy', humidity: 65 },
      'paris': { temp: 18, condition: 'overcast', humidity: 70 },
      'sydney': { temp: 25, condition: 'sunny', humidity: 60 }
    }
    
    const weather = weatherData[city.toLowerCase()] || { temp: 20, condition: 'unknown', humidity: 60 }
    
    const result = {
      city,
      temperature: weather.temp,
      condition: weather.condition,
      humidity: weather.humidity,
      units,
      timestamp: new Date().toISOString()
    }
    
    console.log(`✅ [Weather Tool] ${city}: ${weather.condition}, ${weather.temp}°${units === 'celsius' ? 'C' : 'F'}`)
    return result
  }
)

// Simple recommendation tool
const recommendationTool = createTool(
  'Generate activity recommendations based on weather',
  z.object({
    location: z.string().describe('Location for recommendations'),
    weatherCondition: z.string().describe('Current weather condition'),
    temperature: z.number().describe('Current temperature'),
    preferences: z.string().describe('User preferences for activities')
  }),
  async ({ location, weatherCondition, temperature, preferences }) => {
    console.log(`🎯 [Recommendation Tool] Generating for ${location} (${weatherCondition}, ${temperature}°)`)
    
    const recommendations = []
    
    if (weatherCondition === 'sunny' && temperature > 20) {
      recommendations.push({
        activity: 'Outdoor sightseeing and walking tours',
        reason: 'Perfect sunny weather for exploring outdoors',
        duration: '3-4 hours'
      })
      recommendations.push({
        activity: 'Visit parks and outdoor markets',
        reason: 'Great weather for outdoor activities',
        duration: '2-3 hours'
      })
    } else if (weatherCondition.includes('rain') || weatherCondition === 'overcast') {
      recommendations.push({
        activity: 'Museums and art galleries',
        reason: 'Perfect indoor weather for cultural activities',
        duration: '2-4 hours'
      })
      recommendations.push({
        activity: 'Cozy cafes and restaurants',
        reason: 'Enjoy indoor ambiance during inclement weather',
        duration: '1-2 hours'
      })
    } else {
      recommendations.push({
        activity: 'Flexible indoor/outdoor activities',
        reason: 'Adaptable to current weather conditions',
        duration: '2-3 hours'
      })
    }
    
    const result = {
      location,
      weather: { condition: weatherCondition, temperature },
      recommendations,
      preferences,
      generatedAt: new Date().toISOString()
    }
    
    console.log(`✅ [Recommendation Tool] Generated ${recommendations.length} recommendations`)
    return result
  }
)

async function main() {
  console.log('🚀 Simple Agentic Bedrock Example\n')

  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
    console.error('❌ AWS credentials not found.')
    process.exit(1)
  }

  try {
    console.log('🔗 Connecting to AWS Bedrock...')
    
    console.log('🏭 Creating agentic travel assistant...')
    
    // Create agent factory
    const agentFactory = createExperimentalAgentFactory()

    // Define a simple agentic travel assistant
    const agents = agentFactory.defineAgents({
      travelAgent: {
        name: 'Simple Travel Assistant',
        system: `You are a helpful travel planning assistant. Your goal is to help users plan activities by:

1. First getting current weather information for their destination
2. Then generating personalized activity recommendations based on the weather and their preferences

Always use the available tools in logical sequence and provide helpful explanations for your recommendations.`,
        
        model: await getModel('claude4'),
        tools: {
          weather: weatherTool,
          recommendations: recommendationTool
        },
        
        // Simple agentic configuration
        maxSteps: 5,                           // Allow up to 5 reasoning steps
        stopAfterTools: ['recommendations'],   // Stop after generating recommendations
        temperature: 0.3,
        maxOutputTokens: 1500
      }
    })

    const agent = agents.get('travelAgent')
    console.log(`✅ Created agent: ${agent.getName()}\n`)

    // ==========================================
    // DEMO 1: Basic Agentic Workflow
    // ==========================================
    console.log('=' + '='.repeat(60))
    console.log('DEMO 1: Basic Agentic Travel Planning')
    console.log('=' + '='.repeat(60))

    const prompt1 = "I'm visiting Tokyo tomorrow. I love outdoor activities and cultural experiences. Can you help me plan some activities?"
    
    console.log(`👤 User: ${prompt1}\n`)
    console.log('🤖 Assistant: ')
    
    const streamResult1 = await agent.streamGenerate(prompt1)
    let response1 = ''
    
    for await (const chunk of streamResult1.textStream) {
      process.stdout.write(chunk)
      response1 += chunk
    }
    
    const finalResult1 = await streamResult1.getFinalResult()
    
    console.log('\n\n📊 Demo 1 Results:')
    console.log(`   Content: ${response1.length} characters`)
    console.log(`   Usage: ${finalResult1.usage?.totalTokens} tokens`)
    console.log(`   Tools used: ${finalResult1.toolCalls?.length || 0}`)
    console.log(`   Finish reason: ${finalResult1.finishReason}`)
    
    if (finalResult1.toolCalls && finalResult1.toolCalls.length > 0) {
      console.log('\n🔧 Tool execution sequence:')
      finalResult1.toolCalls.forEach((call, index) => {
        console.log(`   ${index + 1}. ${call.toolName}`)
      })
    }

    // ==========================================
    // DEMO 2: Different Location
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(60))
    console.log('DEMO 2: Different Weather Conditions')
    console.log('=' + '='.repeat(60))

    const prompt2 = "I'm planning a day in London. I enjoy museums, art, and good food. What would you recommend?"
    
    console.log(`👤 User: ${prompt2}\n`)
    console.log('🤖 Assistant: ')
    
    const streamResult2 = await agent.streamGenerate(prompt2)
    let response2 = ''
    
    for await (const chunk of streamResult2.textStream) {
      process.stdout.write(chunk)
      response2 += chunk
    }
    
    const finalResult2 = await streamResult2.getFinalResult()
    
    console.log('\n\n📊 Demo 2 Results:')
    console.log(`   Content: ${response2.length} characters`)
    console.log(`   Usage: ${finalResult2.usage?.totalTokens} tokens`)
    console.log(`   Tools used: ${finalResult2.toolCalls?.length || 0}`)
    console.log(`   Finish reason: ${finalResult2.finishReason}`)

    // ==========================================
    // DEMO 3: Agent Reasoning Analysis
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(60))
    console.log('DEMO 3: Agentic Reasoning Analysis')
    console.log('=' + '='.repeat(60))

    console.log('\n🧠 Agent Reasoning Pattern:')
    console.log('1. Receives user request for travel planning')
    console.log('2. Automatically calls weather tool to get current conditions')
    console.log('3. Uses weather data to call recommendations tool')
    console.log('4. Provides contextual response based on weather and preferences')
    console.log('5. Stops after recommendations (intelligent stop condition)')
    
    console.log('\n⚙️  Stop Conditions Configured:')
    console.log('   • Maximum 5 reasoning steps (prevents infinite loops)')
    console.log('   • Stop after "recommendations" tool call (task completion)')
    
    console.log('\n🎯 This demonstrates the agent\'s ability to:')
    console.log('   ✓ Execute multi-step reasoning automatically')
    console.log('   ✓ Use tools in logical sequence')
    console.log('   ✓ Stop intelligently when task is complete')
    console.log('   ✓ Provide contextual responses based on tool results')

    // ==========================================
    // SUMMARY
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(60))
    console.log('DEMO COMPLETE - SUMMARY')
    console.log('=' + '='.repeat(60))

    const totalTokens = [
      finalResult1.usage?.totalTokens,
      finalResult2.usage?.totalTokens
    ].filter(Boolean).reduce((sum, tokens) => sum + (tokens || 0), 0)

    const totalToolCalls = [
      finalResult1.toolCalls?.length || 0,
      finalResult2.toolCalls?.length || 0
    ].reduce((sum, calls) => sum + calls, 0)

    console.log(`\n📊 Total token usage: ${totalTokens}`)
    console.log(`🔧 Total tool calls: ${totalToolCalls}`)
    
    if (totalTokens > 0) {
      const estimatedCost = (totalTokens / 1000) * 0.009  // Rough average cost estimate
      console.log(`💰 Estimated cost: $${estimatedCost.toFixed(4)}`)
    }
    
    console.log('\n✅ Simple Agentic Bedrock Demo Complete!')
    console.log('\n💡 Key features demonstrated:')
    console.log('   ✓ Autonomous multi-step reasoning with Claude Sonnet 4')
    console.log('   ✓ Intelligent tool usage in logical sequence')
    console.log('   ✓ Smart stop conditions (after task completion)')
    console.log('   ✓ Context-aware responses based on tool results')
    console.log('   ✓ Built on AI SDK 5\'s robust Experimental_Agent')

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main().catch(console.error)

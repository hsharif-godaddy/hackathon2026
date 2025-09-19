/**
 * Full Agentic Bedrock Example
 * 
 * This example demonstrates advanced agentic capabilities:
 * - Custom context injection (app state)
 * - Conversation history management
 * - Multiple conversation turns
 * - Complex tool chains
 * - State persistence across interactions
 */

import 'dotenv/config'
import { getModel } from '../src/providers/unified-provider.js'
import { createTool } from '../src/tools/base-tool.js'
import { createExperimentalAgentFactory } from '../src/core/agent-factory-experimental.js'
import { z } from 'zod'

// Enhanced weather tool
const weatherTool = createTool(
  'Get detailed weather information for a city',
  z.object({
    city: z.string().describe('City name to get weather for'),
    units: z.string().describe('Temperature units: celsius or fahrenheit').optional()
  }),
  async ({ city, units = 'celsius' }) => {
    console.log(`🌤️  [Weather Tool] Getting detailed weather for ${city}...`)
    
    const weatherData: Record<string, any> = {
      'london': { temp: 15, condition: 'rainy', humidity: 78, windSpeed: 12, windDirection: 'SW', visibility: 'good' },
      'tokyo': { temp: 28, condition: 'sunny', humidity: 55, windSpeed: 8, windDirection: 'E', visibility: 'excellent' },
      'new york': { temp: 22, condition: 'partly cloudy', humidity: 65, windSpeed: 15, windDirection: 'NW', visibility: 'good' },
      'paris': { temp: 18, condition: 'overcast', humidity: 70, windSpeed: 10, windDirection: 'W', visibility: 'fair' },
      'sydney': { temp: 25, condition: 'sunny', humidity: 60, windSpeed: 6, windDirection: 'SE', visibility: 'excellent' }
    }
    
    const weather = weatherData[city.toLowerCase()] || { 
      temp: 20, condition: 'unknown', humidity: 60, windSpeed: 10, windDirection: 'N', visibility: 'good' 
    }
    
    const result = {
      city,
      temperature: weather.temp,
      condition: weather.condition,
      humidity: weather.humidity,
      wind: {
        speed: weather.windSpeed,
        direction: weather.windDirection
      },
      visibility: weather.visibility,
      units,
      timestamp: new Date().toISOString(),
      source: 'Weather API'
    }
    
    console.log(`✅ [Weather Tool] ${city}: ${weather.condition}, ${weather.temp}°${units === 'celsius' ? 'C' : 'F'}`)
    return result
  }
)

// Enhanced recommendation tool
const recommendationTool = createTool(
  'Generate detailed activity recommendations',
  z.object({
    location: z.string().describe('Location for recommendations'),
    weatherCondition: z.string().describe('Current weather condition'),
    temperature: z.number().describe('Current temperature'),
    preferences: z.string().describe('User preferences and interests'),
    timeOfDay: z.string().describe('Preferred time of day for activities').optional(),
    budget: z.string().describe('Budget level: low, medium, high').optional()
  }),
  async ({ location, weatherCondition, temperature, preferences, timeOfDay = 'any', budget = 'medium' }) => {
    console.log(`🎯 [Recommendation Tool] Generating for ${location} (${weatherCondition}, ${temperature}°, ${budget} budget)`)
    
    const recommendations = []
    
    if (weatherCondition === 'sunny' && temperature > 20) {
      recommendations.push({
        activity: 'Outdoor food markets and street food tours',
        category: 'Food & Culture',
        reason: 'Perfect sunny weather for exploring local cuisine outdoors',
        duration: '3-4 hours',
        timeRecommendation: 'Morning or early afternoon',
        cost: budget === 'low' ? '$15-25' : budget === 'medium' ? '$25-50' : '$50-100',
        tips: ['Bring sunscreen', 'Stay hydrated', 'Try local specialties']
      })
      recommendations.push({
        activity: 'Walking tours of historic districts',
        category: 'Sightseeing & History',
        reason: 'Excellent weather for outdoor exploration and photography',
        duration: '2-3 hours',
        timeRecommendation: 'Morning or late afternoon',
        cost: budget === 'low' ? '$10-20' : budget === 'medium' ? '$20-40' : '$40-80',
        tips: ['Wear comfortable shoes', 'Bring camera', 'Book in advance for guided tours']
      })
      recommendations.push({
        activity: 'Rooftop bars and outdoor dining',
        category: 'Dining & Social',
        reason: 'Beautiful weather perfect for al fresco dining',
        duration: '2-3 hours',
        timeRecommendation: 'Evening',
        cost: budget === 'low' ? '$20-40' : budget === 'medium' ? '$40-80' : '$80-150',
        tips: ['Make reservations', 'Dress appropriately', 'Enjoy sunset views']
      })
    } else if (weatherCondition.includes('rain') || weatherCondition === 'overcast') {
      recommendations.push({
        activity: 'World-class museums and galleries',
        category: 'Culture & Arts',
        reason: 'Perfect indoor weather for cultural immersion',
        duration: '3-5 hours',
        timeRecommendation: 'Any time',
        cost: budget === 'low' ? '$10-20' : budget === 'medium' ? '$20-35' : '$35-60',
        tips: ['Check for special exhibitions', 'Consider audio guides', 'Plan 2-3 hours per major museum']
      })
      recommendations.push({
        activity: 'Cozy cafes and local coffee culture',
        category: 'Dining & Culture',
        reason: 'Ideal weather for enjoying warm beverages and local atmosphere',
        duration: '1-2 hours',
        timeRecommendation: 'Morning or afternoon',
        cost: budget === 'low' ? '$5-15' : budget === 'medium' ? '$15-30' : '$30-50',
        tips: ['Try local coffee specialties', 'Bring a book', 'Ask locals for recommendations']
      })
      recommendations.push({
        activity: 'Shopping districts and covered markets',
        category: 'Shopping & Culture',
        reason: 'Stay dry while exploring local shopping and crafts',
        duration: '2-4 hours',
        timeRecommendation: 'Any time',
        cost: budget === 'low' ? '$20-50' : budget === 'medium' ? '$50-150' : '$150-500',
        tips: ['Bring umbrella between locations', 'Look for unique local items', 'Negotiate at markets']
      })
    }
    
    const result = {
      location,
      weather: { condition: weatherCondition, temperature },
      recommendations,
      preferences,
      timeOfDay,
      budget,
      totalRecommendations: recommendations.length,
      generatedAt: new Date().toISOString()
    }
    
    console.log(`✅ [Recommendation Tool] Generated ${recommendations.length} detailed recommendations`)
    return result
  }
)

// Booking/information tool
const bookingTool = createTool(
  'Get booking information and practical details for activities',
  z.object({
    activityName: z.string().describe('Name of the activity to get booking info for'),
    location: z.string().describe('City where the activity takes place'),
    timeSlot: z.string().describe('Preferred time slot').optional()
  }),
  async ({ activityName, location, timeSlot = 'flexible' }) => {
    console.log(`📅 [Booking Tool] Getting booking info for "${activityName}" in ${location}`)
    
    const bookingInfo = {
      activity: activityName,
      location,
      availability: 'Available',
      bookingMethods: ['Online website', 'Phone booking', 'Walk-in (subject to availability)'],
      advanceBooking: activityName.toLowerCase().includes('tour') ? '24-48 hours recommended' : 'Same day usually available',
      pricing: {
        adult: '$' + (Math.floor(Math.random() * 50) + 20),
        child: '$' + (Math.floor(Math.random() * 30) + 10),
        senior: '$' + (Math.floor(Math.random() * 40) + 15)
      },
      schedule: {
        monday: '9:00 AM - 6:00 PM',
        tuesday: '9:00 AM - 6:00 PM',
        wednesday: '9:00 AM - 6:00 PM',
        thursday: '9:00 AM - 6:00 PM',
        friday: '9:00 AM - 8:00 PM',
        saturday: '8:00 AM - 8:00 PM',
        sunday: '10:00 AM - 6:00 PM'
      },
      practicalInfo: {
        duration: '2-3 hours',
        meetingPoint: 'Main entrance or specified location',
        whatToBring: ['Comfortable shoes', 'Weather-appropriate clothing', 'Camera'],
        accessibility: 'Wheelchair accessible',
        languages: ['English', 'Local language', 'Spanish', 'French']
      },
      tips: [
        'Arrive 15 minutes early',
        'Check weather conditions',
        'Bring valid ID',
        'Consider travel insurance'
      ],
      contactInfo: {
        phone: '+1-555-0123',
        email: 'info@example.com',
        website: 'https://example.com/booking'
      }
    }
    
    console.log(`✅ [Booking Tool] Booking info ready for ${activityName}`)
    return bookingInfo
  }
)

// Conversation history manager
class ConversationManager {
  private history: Array<{ role: 'user' | 'assistant', content: string, timestamp: Date }> = []

  addUserMessage(content: string) {
    if (content && content.trim().length > 0) {
      this.history.push({ role: 'user', content: content.trim(), timestamp: new Date() })
    }
  }

  addAssistantMessage(content: string) {
    if (content && content.trim().length > 0) {
      this.history.push({ role: 'assistant', content: content.trim(), timestamp: new Date() })
    }
  }

  getHistory() {
    return this.history
  }

  getRecentHistory(count: number = 6) {
    return this.history.slice(-count)
  }

  clear() {
    this.history = []
  }

  getSummary() {
    return {
      totalMessages: this.history.length,
      userMessages: this.history.filter(m => m.role === 'user').length,
      assistantMessages: this.history.filter(m => m.role === 'assistant').length,
      duration: this.history.length > 0 ? 
        this.history[this.history.length - 1].timestamp.getTime() - this.history[0].timestamp.getTime() : 0
    }
  }

  // Debug method to check for potential issues
  validateMessages() {
    const issues = []
    this.history.forEach((msg, index) => {
      if (!msg.content || msg.content.trim().length === 0) {
        issues.push(`Message ${index}: Empty content for ${msg.role}`)
      }
      if (!msg.role || !['user', 'assistant'].includes(msg.role)) {
        issues.push(`Message ${index}: Invalid role '${msg.role}'`)
      }
    })
    return issues
  }
}

// App state simulator
function getAppState() {
  return {
    user: {
      id: 'user_123',
      name: 'Travel Enthusiast',
      preferences: {
        interests: ['history', 'food', 'culture', 'photography'],
        budget: 'medium',
        travelStyle: 'explorer',
        dietaryRestrictions: 'none'
      },
      location: 'Tokyo',
      tripDetails: {
        duration: 5,
        purpose: 'leisure',
        groupSize: 2
      }
    },
    context: {
      currentWeather: {
        city: 'Tokyo',
        condition: 'sunny',
        temperature: 28,
        cached: true,
        lastUpdated: new Date().toISOString()
      },
      time: {
        local: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }),
        timezone: 'Asia/Tokyo'
      }
    }
  }
}

async function runConversationTurn(
  agent: any, 
  userMessage: string, 
  conversationManager: ConversationManager, 
  appState: any,
  usePrecomputedWeather: boolean = false
) {
  console.log(`\n👤 User: ${userMessage}`)
  
  conversationManager.addUserMessage(userMessage)
  
  let contextMessage = `[CURRENT APP STATE]
User: ${appState.user.name} (${appState.user.preferences.budget} budget, interested in ${appState.user.preferences.interests.join(', ')})
Location: ${appState.user.location}
Trip: ${appState.user.tripDetails.duration} days, ${appState.user.tripDetails.groupSize} people
Local Time: ${appState.context.time.local}

Note: Use this app state context for personalized responses.`

  // Optionally inject pre-computed weather to demonstrate context injection
  if (usePrecomputedWeather && appState.context.currentWeather.cached) {
    contextMessage = `[CURRENT APP STATE - WEATHER ALREADY AVAILABLE]
Pre-computed Weather for ${appState.context.currentWeather.city}:
- Condition: ${appState.context.currentWeather.condition}
- Temperature: ${appState.context.currentWeather.temperature}°C
- Last Updated: ${appState.context.currentWeather.lastUpdated}
- Source: Cached app state

User: ${appState.user.name} (${appState.user.preferences.budget} budget, interested in ${appState.user.preferences.interests.join(', ')})
Trip: ${appState.user.tripDetails.duration} days, ${appState.user.tripDetails.groupSize} people

Note: Use the pre-computed weather data above. Do not call weather tools.`
  }

  // Prepare conversation history (filter out any empty messages)
  const messagesToSend = conversationManager.getRecentHistory(4)
    .filter(msg => msg.content && msg.content.trim().length > 0)
    .map(msg => ({
      role: msg.role,
      content: msg.content
    }))
  
  const streamResult = await agent.streamGenerate(userMessage, {
    context: [{
      role: 'user',
      content: contextMessage
    }],
    messages: messagesToSend
  })

  console.log('🤖 Assistant: ')
  
  let assistantResponse = ''
  for await (const chunk of streamResult.textStream) {
    process.stdout.write(chunk)
    assistantResponse += chunk
  }

  conversationManager.addAssistantMessage(assistantResponse)

  const finalResult = await streamResult.getFinalResult()
  
  return {
    response: assistantResponse,
    usage: finalResult.usage,
    toolCalls: finalResult.toolCalls,
    finishReason: finalResult.finishReason
  }
}

async function main() {
  console.log('🚀 Full Agentic Bedrock Example - Advanced Features\n')

  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
    console.error('❌ AWS credentials not found.')
  }

  try {
    console.log('🔗 Connecting to AWS Bedrock...')
    const model = await getModel('claude4')
    
    console.log('🏭 Creating advanced travel planning agent...')
    
    const agentFactory = createExperimentalAgentFactory()

    const agents = agentFactory.defineAgents({
      advancedTravelAgent: {
        name: 'Advanced Travel Planning Agent',
        system: `You are an expert travel planning assistant with access to real-time information and booking capabilities. You help users:

1. Get detailed weather information for their destinations
2. Generate personalized, detailed activity recommendations based on weather, preferences, and budget
3. Provide booking information and practical details for recommended activities

You have access to current app state including user preferences, trip details, and sometimes pre-computed weather data. Always consider:
- User's stated preferences and budget
- Current weather conditions
- Time of day and practical considerations
- Group size and trip duration

Use tools in logical sequence and provide comprehensive, actionable advice.`,
        
        model,
        tools: {
          weather: weatherTool,
          recommendations: recommendationTool,
          booking: bookingTool
        },
        
        maxSteps: 8,                         // Allow more steps for complex interactions
        stopAfterTools: ['booking'],         // Stop after providing booking details
        temperature: 0.3,
        maxOutputTokens: 2500
      }
    })

    const agent = agents.get('advancedTravelAgent')
    const conversationManager = new ConversationManager()
    const appState = getAppState()
    
    console.log(`✅ Created agent: ${agent.getName()}`)
    console.log('📱 App State:', JSON.stringify(appState, null, 2))

    console.log('\n' + '='.repeat(80))
    console.log('ADVANCED AGENTIC CONVERSATION SIMULATION')
    console.log('='.repeat(80))

    // ==========================================
    // TURN 1: Initial planning request
    // ==========================================
    console.log('\n🔄 CONVERSATION TURN 1: Initial Travel Planning')
    console.log('-'.repeat(50))

    const turn1 = await runConversationTurn(
      agent,
      "Hi! I'm planning activities for my 5-day trip to Tokyo. I'm particularly interested in food, culture, and photography. What would you recommend for today?",
      conversationManager,
      appState
    )

    console.log(`\n📊 Turn 1 Stats: ${turn1.usage?.totalTokens} tokens, ${turn1.toolCalls?.length || 0} tools, finish: ${turn1.finishReason}`)

    // ==========================================
    // TURN 2: Follow-up with specific interest
    // ==========================================
    console.log('\n\n🔄 CONVERSATION TURN 2: Specific Interest Follow-up')
    console.log('-'.repeat(50))

    const turn2 = await runConversationTurn(
      agent,
      "That sounds great! I'm especially interested in the food markets you mentioned. Can you give me booking information and practical details for a food tour?",
      conversationManager,
      appState
    )

    console.log(`\n📊 Turn 2 Stats: ${turn2.usage?.totalTokens} tokens, ${turn2.toolCalls?.length || 0} tools, finish: ${turn2.finishReason}`)

    // ==========================================
    // TURN 3: Weather change scenario with pre-computed data
    // ==========================================
    console.log('\n\n🔄 CONVERSATION TURN 3: Weather Change with Pre-computed Data')
    console.log('-'.repeat(50))

    // Simulate weather change in app state
    appState.context.currentWeather = {
      city: 'Tokyo',
      condition: 'rainy',
      temperature: 22,
      cached: true,
      lastUpdated: new Date().toISOString()
    }

    const turn3 = await runConversationTurn(
      agent,
      "I just checked the weather and it looks like it might rain this afternoon. Should I adjust my plans? What indoor alternatives would you suggest?",
      conversationManager,
      appState,
      true  // Use pre-computed weather data
    )

    console.log(`\n📊 Turn 3 Stats: ${turn3.usage?.totalTokens} tokens, ${turn3.toolCalls?.length || 0} tools, finish: ${turn3.finishReason}`)

    // ==========================================
    // TURN 4: Budget and time optimization
    // ==========================================
    console.log('\n\n🔄 CONVERSATION TURN 4: Budget and Time Optimization')
    console.log('-'.repeat(50))

    const turn4 = await runConversationTurn(
      agent,
      "I only have 3 hours this evening and want to keep costs reasonable. From your previous recommendations, what would be the best value activities that fit this timeframe?",
      conversationManager,
      appState
    )

    console.log(`\n📊 Turn 4 Stats: ${turn4.usage?.totalTokens} tokens, ${turn4.toolCalls?.length || 0} tools, finish: ${turn4.finishReason}`)

    // ==========================================
    // CONVERSATION ANALYSIS
    // ==========================================
    console.log('\n\n' + '='.repeat(80))
    console.log('CONVERSATION ANALYSIS')
    console.log('='.repeat(80))

    const conversationSummary = conversationManager.getSummary()
    const totalTokens = [turn1.usage?.totalTokens, turn2.usage?.totalTokens, turn3.usage?.totalTokens, turn4.usage?.totalTokens]
      .filter(Boolean).reduce((sum, tokens) => sum + (tokens || 0), 0)
    
    const totalToolCalls = [turn1.toolCalls?.length, turn2.toolCalls?.length, turn3.toolCalls?.length, turn4.toolCalls?.length]
      .filter(Boolean).reduce((sum, calls) => sum + (calls || 0), 0)

    console.log('\n📊 Conversation Metrics:')
    console.log(`   Total messages: ${conversationSummary.totalMessages}`)
    console.log(`   Conversation duration: ${Math.round(conversationSummary.duration / 1000)} seconds`)
    console.log(`   Total tokens used: ${totalTokens}`)
    console.log(`   Total tool calls: ${totalToolCalls}`)
    
    if (totalTokens > 0) {
      const estimatedCost = (totalTokens / 1000) * 0.009
      console.log(`   Estimated cost: $${estimatedCost.toFixed(4)}`)
    }

    console.log('\n🧠 Advanced Features Demonstrated:')
    console.log('   ✓ Multi-turn conversation with context retention')
    console.log('   ✓ Custom app state injection (user preferences, trip details)')
    console.log('   ✓ Pre-computed weather data usage (avoiding unnecessary API calls)')
    console.log('   ✓ Complex tool chains (weather → recommendations → booking)')
    console.log('   ✓ Conversation history management across turns')
    console.log('   ✓ Dynamic state changes (weather updates)')
    console.log('   ✓ Contextual follow-up questions and refinements')

    console.log('\n🎯 Real-world Use Cases:')
    console.log('   • Travel planning apps with real-time data')
    console.log('   • Personal assistants with user preference learning')
    console.log('   • E-commerce with dynamic recommendations')
    console.log('   • Support systems with conversation context')
    console.log('   • Any app requiring stateful, multi-turn interactions')

    console.log('\n✅ Full Agentic Bedrock Demo Complete!')

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
    console.error(error.stack)
    process.exit(1)
  }
}

main().catch(console.error)

import { createTool } from '@airo/ai-lib'
import { z } from 'zod'

export const weatherTool = createTool(
  'Get current weather information using Open-Meteo API',
  z.object({
    location: z.string().describe('City or location to get weather for')
  }),
  async ({ location }: { location: string }) => {
    console.log('🌤️ Weather tool called for location:', location)
    
    try {
      // First, geocode the location to get coordinates
      const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`
      console.log('📍 Geocoding URL:', geocodeUrl)
      
      const geocodeResponse = await fetch(geocodeUrl)
      console.log('📍 Geocoding response status:', geocodeResponse.status)
      
      if (!geocodeResponse.ok) {
        console.error('❌ Geocoding API error:', geocodeResponse.status, geocodeResponse.statusText)
        return {
          error: `Geocoding API error: ${geocodeResponse.status} ${geocodeResponse.statusText}`,
          location,
          success: false
        }
      }
      
      const geocodeData = await geocodeResponse.json() as {
        results?: Array<{
          latitude: number
          longitude: number
          name: string
          country: string
        }>
      }
      
      console.log(`📍 Geocoding results:`, geocodeData)
      
      if (!geocodeData.results || geocodeData.results.length === 0) {
        console.log('❌ No geocoding results found for location:', location)
        return {
          error: `Location "${location}" not found`,
          location,
          success: false
        }
      }
      
      const { latitude, longitude, name, country } = geocodeData.results[0]
      console.log('📍 Found coordinates:', { latitude, longitude, name, country })
      
      // Get current weather data
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`
      console.log('🌤️ Weather API URL:', weatherUrl)
      
      const weatherResponse = await fetch(weatherUrl)
      console.log('🌤️ Weather response status:', weatherResponse.status)
      
      if (!weatherResponse.ok) {
        console.error('❌ Weather API error:', weatherResponse.status, weatherResponse.statusText)
        return {
          error: `Weather API error: ${weatherResponse.status} ${weatherResponse.statusText}`,
          location,
          success: false
        }
      }
      
      const weatherData = await weatherResponse.json() as {
        current?: {
          temperature_2m: number
          relative_humidity_2m: number
          weather_code: number
          wind_speed_10m: number
          time: string
        }
      }
      
      console.log(`🌤️ Weather data received:`, weatherData)
      
      if (!weatherData.current) {
        console.error(`❌ No current weather data in response`)
        return {
          error: 'Weather data not available',
          location,
          success: false
        }
      }
      
      // Map weather codes to conditions (simplified mapping)
      const getWeatherCondition = (code: number): string => {
        if (code === 0) return 'Clear sky'
        if (code <= 3) return 'Partly cloudy'
        if (code <= 48) return 'Foggy'
        if (code <= 67) return 'Rainy'
        if (code <= 77) return 'Snowy'
        if (code <= 82) return 'Showers'
        if (code <= 99) return 'Thunderstorm'
        return 'Unknown'
      }
      
      const current = weatherData.current
      
      const result = {
        location: `${name}, ${country}`,
        coordinates: { latitude, longitude },
        temperature: Math.round(current.temperature_2m),
        temperatureUnit: '°C',
        condition: getWeatherCondition(current.weather_code),
        humidity: current.relative_humidity_2m,
        windSpeed: current.wind_speed_10m,
        windSpeedUnit: 'km/h',
        timestamp: current.time,
        success: true
      }
      
      console.log(`✅ Weather tool success:`, result)
      return result
      
    } catch (error) {
      console.error(`❌ Weather tool error:`, error)
      const errorResult = {
        error: `Failed to fetch weather data: ${error instanceof Error ? error.message : String(error)}`,
        location,
        success: false
      }
      console.log(`❌ Weather tool returning error:`, errorResult)
      return errorResult
    }
  }
)

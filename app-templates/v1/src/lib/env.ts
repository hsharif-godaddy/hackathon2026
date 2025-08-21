/**
 * Environment variable validation and type safety
 * This ensures all required environment variables are present at build time
 */

import { z } from 'zod'

const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Next.js
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  
  // Database (add as needed)
  // DATABASE_URL: z.string().url(),
  
  // Authentication (add as needed)
  // NEXTAUTH_SECRET: z.string().min(1),
  // NEXTAUTH_URL: z.string().url(),
  
  // External APIs (add as needed)
  // API_KEY: z.string().min(1),
})

const parseEnv = () => {
  try {
    return envSchema.parse(process.env)
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid environment variables:')
      error.errors.forEach((err) => {
        console.error(`  ${err.path.join('.')}: ${err.message}`)
      })
      process.exit(1)
    }
    throw error
  }
}

// Export validated environment variables
export const env = parseEnv()

// Type for environment variables
export type Environment = z.infer<typeof envSchema>

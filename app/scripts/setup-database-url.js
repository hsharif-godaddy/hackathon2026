#!/usr/bin/env node

/**
 * Setup DATABASE_URL from MySQL environment variables if not already set
 */

function setupDatabaseUrl() {
  // If DATABASE_URL is already set, we're good
  if (process.env.DATABASE_URL) {
    const maskedUrl = process.env.DATABASE_URL.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')
    console.log(`✅ DATABASE_URL already set: ${maskedUrl}`)
    return
  }

  console.log('DATABASE_URL not set, constructing from MySQL environment variables...')

  // Check if all required MySQL variables are set
  const requiredVars = {
    MYSQL_DB_PATH: process.env.MYSQL_DB_PATH,
    MYSQL_DB_PORT: process.env.MYSQL_DB_PORT,
    MYSQL_DB_NAME: process.env.MYSQL_DB_NAME,
    MYSQL_DB_USERNAME: process.env.MYSQL_DB_USERNAME,
    MYSQL_DB_PASSWORD: process.env.MYSQL_DB_PASSWORD
  }

  const missingVars = Object.entries(requiredVars)
    .filter(([key, value]) => !value)
    .map(([key]) => key)

  if (missingVars.length > 0) {
    console.error('❌ Missing required MySQL environment variables:')
    Object.entries(requiredVars).forEach(([key, value]) => {
      console.error(`   ${key}: ${value || 'NOT SET'}`)
    })
    process.exit(1)
  }

  // Construct DATABASE_URL
  const { MYSQL_DB_PATH, MYSQL_DB_PORT, MYSQL_DB_NAME, MYSQL_DB_USERNAME, MYSQL_DB_PASSWORD } = requiredVars
  const databaseUrl = `mysql://${MYSQL_DB_USERNAME}:${MYSQL_DB_PASSWORD}@${MYSQL_DB_PATH}:${MYSQL_DB_PORT}/${MYSQL_DB_NAME}`

  // Set the environment variable
  process.env.DATABASE_URL = databaseUrl

  // Log success (with masked password)
  const maskedUrl = databaseUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')
  console.log(`✅ DATABASE_URL constructed: ${maskedUrl}`)
}

// If this script is run directly, set up DATABASE_URL and then run the command
if (require.main === module) {
  setupDatabaseUrl()

  // Get remaining command line arguments and execute them
  const args = process.argv.slice(2)
  if (args.length > 0) {
    const { spawn } = require('child_process')
    const child = spawn(args[0], args.slice(1), {
      stdio: 'inherit',
      env: process.env
    })

    child.on('exit', (code) => {
      process.exit(code || 0)
    })
  }
} else {
  // If required as a module, export the setup function
  module.exports = setupDatabaseUrl
}

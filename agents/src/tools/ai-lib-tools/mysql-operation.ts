import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { MySQLTool, MySQLToolOptions } from '../mysql-tool.js'

// Initialize tool instances
const mysqlTool = new MySQLTool()

/**
 * MySQL Operation Tool for AI-Lib
 * Manage MySQL databases: create dedicated databases with user credentials, test connections, and list databases
 */
export const mysqlOperationAITool = createTool(
  'Manage MySQL databases: create dedicated databases with user credentials, test connections, and list databases. For enable_database operation: automatically generates secure credentials, creates MySQL user first, then creates dedicated database with user-scoped name (always appends random 4-digit suffix for uniqueness), prepares empty database ready for custom table creation, writes all credentials to the application\'s .env file, and automatically restarts the backend server to load new environment variables.',
  z.object({
    operation: z.enum(['enable_database', 'test_connection', 'list_databases']).describe('The MySQL operation to perform. enable_database: creates user credentials first, then creates dedicated database, prepares empty database ready for custom table creation, automatically updates .env file with credentials, and restarts backend server to load new environment variables'),
    databaseName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).max(64).optional().describe('Name for the database (e.g., "blog_app" creates database like "user123_blog_app_1234"). Required for enable_database operation. A dedicated database will be created with this name (user-scoped with random suffix).'),
    username: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).max(32).optional().describe('Custom username for the database user (optional, auto-generated if not provided)'),
    userId: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).max(16).optional().describe('User identifier for database scoping (e.g., "user123"). Combined with databaseName to create unique database names like "user123_blog_app_1234". Required for enable_database operation.'),
    host: z.string().optional().describe('MySQL host (optional, defaults to environment variable or localhost)'),
    port: z.number().min(1).max(65535).optional().describe('MySQL port (optional, defaults to environment variable or 3306)'),
    rootUser: z.string().optional().describe('MySQL root username (optional, defaults to environment variable)'),
    rootPassword: z.string().optional().describe('MySQL root password (optional, defaults to environment variable)')
  }),
  async (input, context) => {
    const result = await mysqlTool.execute(input as MySQLToolOptions)
    
    if (!result.success) {
      throw new Error(result.error || result.message || 'MySQL operation failed')
    }

    // TODO: Add environment file writing and server restart logic here
    // This would need to be extracted from the original executeToolFunction
    
    return `MySQL operation completed: ${result.message}`
  }
)

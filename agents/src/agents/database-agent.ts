import { BaseAgent } from '../base/index.js';
import type { AgentConfig, AgentExecutionContext } from '../base/index.js';

/**
 * Database Agent - MySQL database operations and management
 */
export class DatabaseAgent extends BaseAgent {
  private appPath: string;

  constructor(options?: { appPath?: string }) {
    const config: AgentConfig = {
      id: 'database',
      name: 'Database Manager',
      description: 'A specialized Database Agent focused on MySQL database operations, user management, and backend server coordination',
      model: 'claude-sonnet-4-20250514',
      tools: [
        { 
          name: 'mysql_operation', 
          description: 'Manage MySQL databases: create dedicated databases with user credentials, test connections, and list databases'
        },
        { 
          name: 'server_restart', 
          description: 'Restart development server (CRITICAL: use after database configuration changes)'
        },
        { 
          name: 'server_status', 
          description: 'Check if server is running and get status details'
        },
        { 
          name: 'server_stop', 
          description: 'Stop development server temporarily'
        },

        { 
          name: 'file_edit', 
          description: 'Edit, create, or rewrite files for database configuration'
        },
        { 
          name: 'read_file', 
          description: 'Read file contents for checking database configurations and .env files'
        },
        { 
          name: 'terminal_command', 
          description: 'Execute shell commands for database-related tasks'
        },
        { 
          name: 'directory_listing', 
          description: 'List directory contents to understand project structure'
        },
      ],
      contextBuilder: {
        tools: ['database_manager', 'server_manager'],
        skipContextBuilding: false,
      },
      handoffs: [
        {
          agentName: 'develop',
          description: 'Hand back control to Development Agent after completing database operations. Use when database setup is complete and frontend integration is needed.'
        }
      ],
      version: '2.0.0',
      tags: ['database', 'mysql', 'backend', 'server-management'],
      promptComposition: {
        // Database-specific prompt will be loaded from database.md
      },
    };

    super(config);
    this.appPath = options?.appPath || '.';
  }

  /**
   * Customize system prompt with database-specific context
   */
  protected customizeSystemPrompt(
    basePrompt: string,
    context?: AgentExecutionContext
  ): string {
    let customizedPrompt = basePrompt;

    // Add current timestamp for time-aware responses
    if (context?.timestamp) {
      customizedPrompt += `\n\nCurrent timestamp: ${context.timestamp.toISOString()}`;
    }

    // Add session context
    if (context?.userId) {
      customizedPrompt += `\nDatabase session ID: ${context.userId}`;
    }

    if (context?.threadId) {
      customizedPrompt += `\nProject thread ID: ${context.threadId}`;
    }

    // Add visual context guidance if available
    const visualContext = context?.metadata?.visualContext as any;
    const visualContextSection = this.generateVisualContextSection(
      context,
      `When the user refers to database features like "this form", "these fields", or "this data", they likely mean:
1. Database-related components in the "${visualContext?.active_section || 'current'}" section
2. Forms or data elements currently visible in their viewport
3. Content they're viewing that needs database integration

Focus database setup and integration on the areas they're currently working with.`
    );
    customizedPrompt += visualContextSection;

    // Add database-specific context
    customizedPrompt += `\n\n## Database Agent Operation Context

### Core Workflow
1. **Database Setup**: Use \`mysql_operation\` with \`enable_database\` operation
   - Automatically creates database, user, and credentials
   - Writes configuration to .env file
   - Auto-restarts backend server
2. **Verification**: Confirm integration success
3. **Handoff**: Return control to Development Agent for frontend work

### Tool Usage Guidelines
- **\`mysql_operation\`**: Primary tool for all database operations
  - \`enable_database\`: Complete database setup (most common)
  - \`test_connection\`: Verify database connectivity
  - \`list_databases\`: Show user's databases

- **\`server_status\`**: Check server health if issues arise
- **\`server_restart\`**: Manual restart only if auto-restart fails

### Success Criteria
✅ Database and user created successfully
✅ Credentials written to .env file  
✅ Server restarted and running
✅ Ready for frontend integration

### Error Handling
- If database creation fails: Check MySQL connectivity and permissions
- If server restart fails: Use manual \`server_restart\` tool
- If integration fails: Verify .env file and server status
- Always provide clear error messages and next steps

### Security Reminders
- Never expose database credentials in responses
- Use tool-generated secure passwords only
- Confirm operations without revealing sensitive data`;

    return customizedPrompt;
  }

  /**
   * Validation for database agent
   */
  protected async customValidation(): Promise<void> {
    const tools = this.getTools();
    const hasMySQL = tools.some(tool => tool.name === 'mysql_operation');
    const hasServerRestart = tools.some(tool => tool.name === 'server_restart');
    
    if (!hasMySQL) {
      throw new Error('Database agent must have mysql_operation tool');
    }
    
    if (!hasServerRestart) {
      throw new Error('Database agent must have server_restart tool for backend coordination');
    }
  }

  /**
   * Initialize the database agent
   */
  protected async customInitialization(): Promise<void> {
    console.log('🗄️ Initializing Database Agent...');
    console.log('Ready to manage MySQL databases and coordinate server operations!');
  }

  /**
   * Log tool usage for database operations tracking
   */
  async beforeToolExecution(toolName: string, args: unknown): Promise<unknown> {
    console.log(`🔧 Executing database tool: ${toolName}`);
    
    // Special handling for critical operations
    if (toolName === 'mysql_operation') {
      const operation = (args as any)?.operation;
      if (operation === 'enable_database') {
        console.log('⚠️ CRITICAL: Database creation - server restart will be required');
      }
    }
    
    return args;
  }

  /**
   * Track database operations and ensure proper server management
   */
  async afterToolExecution(
    toolName: string,
    args: unknown,
    result: unknown
  ): Promise<unknown> {
    console.log(`✅ Completed database action: ${toolName}`);
    
    // Provide guidance after database operations
    if (toolName === 'mysql_operation') {
      const operation = (args as any)?.operation;
      if (operation === 'enable_database') {
        console.log('🔄 NEXT STEP: Use server_restart tool to apply database configuration changes');
      }
    }
    
    return result;
  }

  /**
   * Get database-specific recommendations
   */
  getOperationGuidance(operation: string): string {
    const guidelines: Record<string, string> = {
      'enable_database': `
CRITICAL WORKFLOW:
1. Use mysql_operation to create database and user
2. IMMEDIATELY use server_restart to apply changes
3. Use server_status to verify server is running
4. Test database connection through API endpoints
      `,
      'database_configuration': `
ENVIRONMENT SETUP:
1. mysql_operation automatically updates .env file
2. Use server_restart after any .env changes
3. Verify with server_status and health checks
      `,
      'troubleshooting': `
DEBUGGING STEPS:
1. Check server_status for current state
2. Use server_restart if server is unresponsive
3. Check .env file for correct database credentials
      `
    };
    
    return guidelines[operation] || 'Use appropriate database and server management tools for your operation.';
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Database Agent cleanup completed');
  }

  /**
   * Complete database integration for an application
   * This method uses the DatabaseAgent's mysql_operation tool properly
   */
  async completeDatabaseIntegration(params: { userId: string; databaseName: string }): Promise<any> {
    console.log(`🗄️ DatabaseAgent: Starting database integration for user: ${params.userId}, database: ${params.databaseName}`);
    
    try {
      // Use the DatabaseAgent's mysql_operation tool (proper approach)
      // This goes through the agent's tool system
      const { MySQLTool } = await import('../tools/mysql-tool.js');
      const mysqlTool = new MySQLTool();
      
      // Create database and user using the agent's designated tool
      const result = await mysqlTool.execute({
        operation: 'enable_database',
        databaseName: params.databaseName,
        userId: params.userId
      });
      
      if (!result.success) {
        throw new Error(result.message || 'Database creation failed');
      }
      
      console.log('✅ DatabaseAgent: Database integration completed successfully');
      console.log('🔄 DatabaseAgent: Returning control to Development Agent for frontend integration...');
      
      return {
        success: true,
        summary: result.message,
        credentials: {
          database: result.data?.databaseName || `${params.userId}_${params.databaseName}`,
          user: result.data?.username,
          password: result.data?.password
        },
        backendPort: 3000
      };
      
    } catch (error) {
      console.error('❌ DatabaseAgent: Database integration failed:', error);
      return {
        success: false,
        message: `Database integration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
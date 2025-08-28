import { BaseAgent } from '../base/index.js';
import type { AgentConfig, AgentExecutionContext } from '../base/index.js';

/**
 * Develop Agent - AI developer for building web applications
 */
export class DevelopAgent extends BaseAgent {
  private appPath: string;

  constructor(options?: { appPath?: string }) {
    const config: AgentConfig = {
      id: 'develop',
      name: 'AI Developer',
      description: 'An AI developer agent that helps build web applications, websites, and digital solutions. Specializes in API generation from database schemas with flexible CRUD operations, full-stack development, and modern web technologies.',
      model: 'claude-sonnet-4-20250514',
      tools: [
        { 
          name: 'directory_listing', 
          description: 'List directory contents as a tree structure with filtering options',
          config: {
            additionalIgnorePatterns: ['dev-tools', 'source-mapper']
          }
        },
        { name: 'terminal_command', description: 'Execute shell commands within the app directory for development tasks' },
        { name: 'file_edit', description: 'Edit, create, or rewrite files with intelligent mode detection and safety features' },
        { name: 'git_operation', description: 'Perform git operations like status, add, commit, diff, log, and branch management' },
        { name: 'read_file', description: 'Read file contents with optional line range support for examining code and configuration files' },
        { name: 'grep_search', description: 'Search for text or patterns across files in the project to find code, locate definitions, or understand structure' },
        { name: 'server_restart', description: 'Restart development server (use after database changes, dependency installs)' },
        { name: 'server_status', description: 'Check if server is running and get status details' },
        { name: 'server_stop', description: 'Stop development server temporarily' },
        { name: 'auto_api_generator', description: 'Automatically generate API endpoints from database schemas - can create selective operations (e.g., only Create or Read or Update or Delete APIs), analyze database tables, generate TypeScript types, and create REST API routes for any combination of operations' },

      ],
      contextBuilder: {
        tools: ['code_generator', 'file_manager'],
        skipContextBuilding: false,
      },
      handoffs: [],
      version: '1.0.0',
      tags: ['developer', 'coding', 'web-development', 'ai-assistant', 'api-generation', 'database', 'crud', 'backend'],
      promptComposition: {
        // Templates are now dynamically detected based on the app structure
        // No need to hardcode templates here
      },
    };

    super(config);
    this.appPath = options?.appPath || '.';
  }

  /**
   * Customize system prompt with development context
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
      customizedPrompt += `\nDeveloper session ID: ${context.userId}`;
    }

    if (context?.threadId) {
      customizedPrompt += `\nProject thread ID: ${context.threadId}`;
    }

    // Add visual context guidance if available
    const visualContextSection = this.generateVisualContextSection(
      context,
      `Use this context to make targeted, precise changes to the right parts of their application.`
    );
    customizedPrompt += visualContextSection;

    // Add development-specific context
    customizedPrompt += `\n\n## AI Edit Context
When a user selects a specific element in their application for editing, you will receive a separate message containing the element details and source code location. Use this information to make precise, targeted edits.

## Visual Context Integration
When users provide ambiguous instructions like "edit this" or "change the color here":
1. Check if visual context is available to understand their current view
2. Focus on elements in the active section they're viewing
3. Consider their scroll position to target the right content area
4. If both visual context AND element selection are provided, prioritize the selected element
5. When visual context suggests a section but no specific element is selected, scan that section for likely targets

## General Development Guidelines:
- Always write clean, maintainable, and well-documented code
- Use modern web development best practices
- Prefer TypeScript for type safety when possible
- Follow responsive design principles
- Include proper error handling
- Suggest testing strategies when appropriate
- Consider accessibility (a11y) in UI implementations`;

    return customizedPrompt;
  }

  /**
   * Validation for development agent
   */
  protected async customValidation(): Promise<void> {
    if (this.getTools().length < 2) {
      throw new Error('Develop agent must have at least basic development tools');
    }
  }

  /**
   * Initialize the development environment
   */
  protected async customInitialization(): Promise<void> {
    console.log('Initializing AI Developer Agent...');
    console.log('Ready to help build amazing web applications!');
  }

  /**
   * Log tool usage for development tracking
   */
  async beforeToolExecution(toolName: string, args: unknown): Promise<unknown> {
    console.log(`🔧 Executing development tool: ${toolName}`);
    return args;
  }

  /**
   * Track development progress
   */
  async afterToolExecution(
    toolName: string,
    args: unknown,
    result: unknown
  ): Promise<unknown> {
    console.log(`✅ Completed development action: ${toolName}`);
    return result;
  }

  /**
   * Hand off to Database Agent for MySQL setup
   */
  async handoffToDatabase(params: { userId: string; databaseName: string }): Promise<any> {
    console.log('🔄 Handing off to Database Agent for MySQL setup...');
    
    const { DatabaseAgent } = await import('./database-agent.js');
    const databaseAgent = new DatabaseAgent({ appPath: this.appPath });
    await databaseAgent.initialize();
    
    try {
      const result = await databaseAgent.completeDatabaseIntegration(params);
      console.log('✅ Database Agent handoff completed successfully');
      console.log('🔗 Backend integration ready for frontend development');
      
      return {
        success: result.success,
        message: result.summary || 'Database setup completed. Ready for frontend integration.',
        credentials: result.credentials,
        backendPort: result.backendPort || 3000
      };
    } finally {
      await databaseAgent.cleanup();
    }
  }



  /**
   * Detect port configuration from .dev-ports.json
   */
  async detectPortConfiguration(): Promise<any> {
    try {
      const fs = require('fs');
      const portConfig = JSON.parse(fs.readFileSync('.dev-ports.json', 'utf8'));
      return portConfig;
    } catch {
      return {};
    }
  }

  /**
   * Generate API integration files for frontend
   */
  generateApiIntegration(credentials: any, backendPort: number): any {
    const files = [
      {
        path: 'src/lib/api-client.ts',
        content: this.generateApiClientCode(backendPort)
      },
      {
        path: 'src/hooks/useDatabase.ts',
        content: this.generateDatabaseHooksCode(backendPort)
      },
      {
        path: 'vite.config.ts',
        content: this.generateViteConfigCode(backendPort)
      }
    ];

    const instructions = `
# Frontend Integration Complete

Generated ${files.length} integration files:
1. **src/lib/api-client.ts** - API client using Vite proxy pattern (/api routes)
2. **src/hooks/useDatabase.ts** - React hooks for database operations via proxy
3. **vite.config.ts** - Vite configuration with proxy setup for backend

## Key Features:
- Vite proxy configuration for /api routes
- Backend running on port ${backendPort}
- Frontend uses relative /api paths (proxied by Vite)
- Automatic proxy setup in vite.config.ts

## Usage:
\`\`\`typescript
import { useDatabase } from './hooks/useDatabase';
import api from './lib/api-client';

// All API calls use /api paths, proxied by Vite to backend
// Example: fetch('/api/users') -> proxied to http://localhost:${backendPort}/api/users
\`\`\`
    `.trim();

    return { files, instructions };
  }

  /**
   * Generate API client code with Vite proxy pattern
   */
  private generateApiClientCode(backendPort: number): string {
    return `// API Client using Vite proxy pattern
// ALWAYS use relative /api paths - proxied by Vite to backend
import { API_BASE_URL } from '@/shared/constants';

class ApiClient {
  private baseURL: string;
  
  constructor() {
    this.baseURL = API_BASE_URL; // '/api' - proxied by Vite
  }
  
  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(\`\${this.baseURL}\${endpoint}\`);
    if (!response.ok) throw new Error(\`GET \${endpoint} failed\`);
    return response.json();
  }
  
  async post<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch(\`\${this.baseURL}\${endpoint}\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(\`POST \${endpoint} failed\`);
    return response.json();
  }
  
  async put<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch(\`\${this.baseURL}\${endpoint}\`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(\`PUT \${endpoint} failed\`);
    return response.json();
  }
  
  async delete<T>(endpoint: string): Promise<T> {
    const response = await fetch(\`\${this.baseURL}\${endpoint}\`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error(\`DELETE \${endpoint} failed\`);
    return response.json();
  }
  
  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(\`\${this.baseURL}/health\`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

export default new ApiClient();`;
  }

  /**
   * Generate React hooks for database operations
   */
  private generateDatabaseHooksCode(backendPort: number): string {
    return `import { useState, useEffect } from 'react';
import { API_BASE_URL } from '@/shared/constants';

interface DatabaseHookResult {
  isConnected: boolean;
  apiUrl: string;
  testConnection: () => Promise<boolean>;
}

export const useDatabase = (): DatabaseHookResult => {
  const [isConnected, setIsConnected] = useState(false);
  
  // Use Vite proxy - all /api calls are proxied to backend
  const apiUrl = API_BASE_URL; // '/api'
  
  const testConnection = async (): Promise<boolean> => {
    try {
      const response = await fetch(\`\${apiUrl}/health\`);
      const connected = response.ok;
      setIsConnected(connected);
      return connected;
    } catch {
      setIsConnected(false);
      return false;
    }
  };
  
  useEffect(() => {
    testConnection();
  }, []);
  
  return {
    isConnected,
    apiUrl,
    testConnection
  };
};

export const useApi = () => {
  const { apiUrl } = useDatabase();
  
  const request = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(\`\${apiUrl}\${endpoint}\`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    if (!response.ok) {
      throw new Error(\`API request failed: \${response.statusText}\`);
    }
    
    return response.json();
  };
  
  return { request, apiUrl };
};`;
  }

  /**
   * Generate Vite configuration with proxy setup
   */
  private generateViteConfigCode(backendPort: number): string {
    return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, // Frontend port
    proxy: {
      '/api': {
        target: 'http://localhost:${backendPort}',
        changeOrigin: true,
      },
    },
  },
});`;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Development Agent cleanup completed');
  }
}

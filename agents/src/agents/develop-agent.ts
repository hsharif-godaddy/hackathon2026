import { BaseAgent } from '../base/index.js';
import type { AgentConfig, AgentExecutionContext } from '../base/index.js';

/**
 * Develop Agent - AI developer for building web applications
 */
export class DevelopAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      id: 'develop',
      name: 'AI Developer',
      description: 'An AI developer agent that helps build web applications, websites, and digital solutions',
      model: 'gpt-4',
      tools: [
        { name: 'code_generator', description: 'Generate code for web applications' },
        { name: 'file_manager', description: 'Create, read, and modify project files' },
        { name: 'dependency_manager', description: 'Manage project dependencies and configurations' },
        { name: 'deployment_helper', description: 'Help with deployment and hosting setup' },
      ],
      contextBuilder: {
        tools: ['code_generator', 'file_manager'],
        skipContextBuilding: false,
      },
      handoffs: [],
      version: '1.0.0',
      tags: ['developer', 'coding', 'web-development', 'ai-assistant'],
    };

    super(config);
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

    // Add development-specific context
    customizedPrompt += `\n\n## Development Guidelines:
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
}

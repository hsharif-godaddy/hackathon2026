import { BaseAgent } from '../base/index.js';
import type { AgentConfig, AgentExecutionContext } from '../base/index.js';

/**
 * Example Agent - demonstrates the new class-based agent architecture
 */
export class ExampleAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      id: 'example-agent',
      name: 'Example Agent',
      description: 'A simple example agent that demonstrates the class-based architecture',
      model: 'gpt-4',
      tools: [
        { name: 'example_tool', description: 'An example tool for demonstration' },
        { name: 'another_tool', description: 'Another example tool' },
      ],
      contextBuilder: {
        tools: [],
        skipContextBuilding: true,
      },
      handoffs: [],
      version: '1.0.0',
      tags: ['example', 'demo', 'reference'],
    };

    super(config);
  }

  /**
   * Example of customizing the system prompt
   */
  protected customizeSystemPrompt(
    basePrompt: string,
    context?: AgentExecutionContext
  ): string {
    let customizedPrompt = basePrompt;

    // Add current time context
    if (context?.timestamp) {
      customizedPrompt += `\n\nCurrent timestamp: ${context.timestamp.toISOString()}`;
    }

    // Add user context if available
    if (context?.userId) {
      customizedPrompt += `\nUser ID: ${context.userId}`;
    }

    // Add thread context
    if (context?.threadId) {
      customizedPrompt += `\nThread ID: ${context.threadId}`;
    }

    return customizedPrompt;
  }

  /**
   * Example of custom validation
   */
  protected async customValidation(): Promise<void> {
    // Example validation logic
    if (this.getTools().length < 1) {
      throw new Error('Example agent must have at least one tool');
    }
  }

  /**
   * Example of custom initialization
   */
  protected async customInitialization(): Promise<void> {
    console.log('Initializing Example Agent...');
    // Perform any setup needed for this agent
    console.log('Example Agent ready!');
  }

  /**
   * Example of before tool execution hook
   */
  async beforeToolExecution(toolName: string, args: unknown): Promise<unknown> {
    console.log(`About to execute tool: ${toolName}`);
    return args;
  }

  /**
   * Example of after tool execution hook
   */
  async afterToolExecution(
    toolName: string,
    args: unknown,
    result: unknown
  ): Promise<unknown> {
    console.log(`Completed tool execution: ${toolName}`);
    return result;
  }
}

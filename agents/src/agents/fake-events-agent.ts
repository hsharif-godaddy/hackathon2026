import { BaseAgent } from '../base/index.js';
import type { AgentConfig, AgentExecutionContext } from '../base/index.js';

/**
 * Fake Events Agent - produces fake SSE events for debugging frontend integration
 */
export class FakeEventsAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      id: 'fake-events',
      name: 'Fake Events Agent',
      description: 'A debugging agent that produces fake SSE events for testing frontend integration',
      model: 'gpt-4',
      tools: [],
      contextBuilder: {
        tools: [],
        skipContextBuilding: true,
      },
      handoffs: [],
      version: '1.0.0',
      tags: ['debug', 'testing', 'sse', 'fake'],
    };

    super(config);
  }

  /**
   * Custom initialization for fake events agent
   */
  protected async customInitialization(): Promise<void> {
    console.log('Initializing Fake Events Agent for SSE debugging...');
    console.log('Ready to produce fake events!');
  }

  /**
   * Override the full validation method since this agent doesn't need tools
   */
  async validate(): Promise<void> {
    // Basic validation
    if (!this._config.id) {
      throw new Error('Agent must have an id');
    }
    
    if (!this._config.name) {
      throw new Error('Agent must have a name');
    }
    
    // Validate that system prompt can be loaded
    try {
      await this.getSystemPrompt();
    } catch (error) {
      throw new Error(
        `System prompt validation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    
    // Skip tool validation for this special agent
    // Call our custom validation
    await this.customValidation();
  }

  /**
   * Custom validation - no additional validation needed
   */
  protected async customValidation(): Promise<void> {
    // No additional validation needed for fake events agent
  }

  /**
   * Generate fake SSE events for debugging
   */
  async generateFakeEvents(res: any, context: AgentExecutionContext): Promise<void> {
    const eventTypes = [
      'status',
      'content',
      'tool_result',
      'metadata',
      'progress',
      'debug'
    ];

    const statusMessages = [
      'Processing request...',
      'Analyzing data...',
      'Generating response...',
      'Optimizing output...',
      'Finalizing results...'
    ];

    const contentChunks = [
      'This is the first chunk of fake content. ',
      'Here comes some more simulated text data. ',
      'Adding additional content to test streaming. ',
      'More fake content for debugging purposes. ',
      'Continuing with the stream of fake data. ',
      'Almost done with the fake content generation. ',
      'Testing different types of content chunks. ',
      'Simulating a realistic conversation flow. ',
      'Final bits of fake content coming through. ',
      'Last chunk of fake content for testing. '
    ];

    for (let i = 1; i <= 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

      const eventType = eventTypes[i % eventTypes.length];
      let eventData: any;

      switch (eventType) {
        case 'status':
          eventData = {
            type: 'status',
            status: 'processing',
            message: statusMessages[i % statusMessages.length],
            step: i,
            total: 10
          };
          break;

        case 'content':
          eventData = {
            type: 'content',
            content: contentChunks[i - 1] || `Fake content chunk ${i}`,
            isComplete: i === 10
          };
          break;

        case 'tool_result':
          eventData = {
            type: 'tool_result',
            tool_name: `fake_tool_${i}`,
            tool_result: `Fake tool result ${i}: { "data": "simulated", "count": ${i}, "timestamp": "${new Date().toISOString()}" }`
          };
          break;

        case 'metadata':
          eventData = {
            type: 'metadata',
            step: i,
            progress: Math.round((i / 10) * 100),
            model: 'fake-model-v1',
            tokens_used: i * 50
          };
          break;

        case 'progress':
          eventData = {
            type: 'progress',
            current: i,
            total: 10,
            percentage: Math.round((i / 10) * 100),
            message: `Processing step ${i} of 10`
          };
          break;

        case 'debug':
          eventData = {
            type: 'debug',
            level: 'info',
            message: `Debug event ${i}: Fake debugging information`,
            timestamp: new Date().toISOString(),
            context: {
              threadId: context.threadId,
              userId: context.userId,
              step: i
            }
          };
          break;

        default:
          eventData = {
            type: 'generic',
            message: `Fake event ${i}`,
            data: { eventNumber: i, timestamp: new Date().toISOString() }
          };
      }

      // Send the fake event
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
      console.log(`📡 Sent fake event ${i}/10:`, eventType);
    }

    // Send final completion event
    res.write(`data: ${JSON.stringify({
      type: 'content',
      content: '\n\n✅ Fake events debugging complete! All 10 events have been sent.',
      isComplete: true
    })}\n\n`);

    console.log('🎉 Fake events sequence completed');
  }
}

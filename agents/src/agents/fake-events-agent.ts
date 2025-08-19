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
        `System prompt validation failed: ${error instanceof Error ? error.message : String(error)
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

      let eventData: any;

      eventData = {
        type: 'content',
        content: contentChunks[i - 1] || `Fake content chunk ${i}`,
        isComplete: i === 10
      };


      // Send the fake event
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
      console.log(`📡 Sent fake event ${i}/10:`);
    }


    // Send final completion event
    res.write(`data: ${JSON.stringify({
      type: 'content',
      content: '\n\n✅ Fake events debugging complete! All 10 events have been sent.',
      isComplete: true
    })}\n\n`);

    console.log('🎉 Fake events sequence completed');
  }

  /**
   * Generate fake WebSocket events for debugging
   */
  async generateFakeEventsWS(ws: any, context: AgentExecutionContext): Promise<void> {
    const contentChunks = [
      'This is the first chunk of fake WebSocket content. ',
      'Here comes some more simulated text data via WebSocket. ',
      'Adding additional content to test WebSocket streaming. ',
      'More fake content for WebSocket debugging purposes. ',
      'Continuing with the stream of fake WebSocket data. ',
      'Almost done with the fake WebSocket content generation. ',
      'Testing different types of WebSocket content chunks. ',
      'Simulating a realistic WebSocket conversation flow. ',
      'Final bits of fake WebSocket content coming through. ',
      'Last chunk of fake WebSocket content for testing. '
    ];

    for (let i = 1; i <= 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

      const eventData = {
        type: 'content',
        content: contentChunks[i - 1] || `Fake WebSocket content chunk ${i}`,
        isComplete: i === 10
      };

      // Send the fake event via WebSocket
      ws.send(JSON.stringify(eventData));
      console.log(`📡 Sent fake WebSocket event ${i}/10:`);
    }

    // Send final completion event
    ws.send(JSON.stringify({
      type: 'content',
      content: '\n\n✅ Fake WebSocket events debugging complete! All 10 events have been sent.',
      isComplete: true
    }));

    console.log('🎉 Fake WebSocket events sequence completed');
  }
}

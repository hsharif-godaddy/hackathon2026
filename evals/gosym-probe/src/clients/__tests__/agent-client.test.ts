import { describe, it, expect } from 'vitest';
import type { AgentClient, AgentEvent, ToolInfo } from '../agent-client.js';
import type { SetupContext } from '../../scenarios/types.js';

class MockAgentClient implements AgentClient {
  private handlers: ((event: AgentEvent) => void)[] = [];
  public sent: string[] = [];
  public disconnected = false;
  public configuredCtx?: SetupContext;

  configure(ctx: SetupContext): void {
    this.configuredCtx = ctx;
  }

  send(message: string): void {
    this.sent.push(message);
  }

  onMessage(handler: (event: AgentEvent) => void): void {
    this.handlers.push(handler);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  emit(event: AgentEvent): void {
    for (const h of this.handlers) h(event);
  }
}

describe('AgentClient interface contract', () => {
  it('mock implementation satisfies AgentClient interface', () => {
    const client: AgentClient = new MockAgentClient();
    expect(typeof client.configure).toBe('function');
    expect(typeof client.send).toBe('function');
    expect(typeof client.onMessage).toBe('function');
    expect(typeof client.disconnect).toBe('function');
  });

  it('configure() stores the setup context', () => {
    const client = new MockAgentClient();
    const ctx: SetupContext = { appId: 'my-app', extra: 42 };
    client.configure(ctx);
    expect(client.configuredCtx).toEqual(ctx);
  });

  it('send() routes message to implementation', () => {
    const client = new MockAgentClient();
    client.send('hello');
    expect(client.sent).toEqual(['hello']);
  });

  it('onMessage() receives events dispatched by implementation', () => {
    const client = new MockAgentClient();
    const received: AgentEvent[] = [];
    client.onMessage((e) => received.push(e));
    client.emit({ type: 'complete', content: 'hello' });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: 'complete', content: 'hello' });
  });

  it('multiple onMessage() handlers all receive events', () => {
    const client = new MockAgentClient();
    const r1: AgentEvent[] = [];
    const r2: AgentEvent[] = [];
    client.onMessage((e) => r1.push(e));
    client.onMessage((e) => r2.push(e));
    client.emit({ type: 'complete', content: 'done' });
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it('disconnect() marks client as disconnected', () => {
    const client = new MockAgentClient();
    client.disconnect();
    expect(client.disconnected).toBe(true);
  });

  describe('AgentEvent discriminated union', () => {
    it('tool_start event has tool with id and name', () => {
      const tool: ToolInfo = { id: 't1', name: 'read_file' };
      const event: AgentEvent = { type: 'tool_start', tool };
      if (event.type === 'tool_start') {
        expect(event.tool.id).toBe('t1');
        expect(event.tool.name).toBe('read_file');
      }
    });

    it('tool_call event has tool info', () => {
      const tool: ToolInfo = { id: 't2', name: 'write_file' };
      const event: AgentEvent = { type: 'tool_call', tool };
      if (event.type === 'tool_call') {
        expect(event.tool.name).toBe('write_file');
      }
    });

    it('tool_input_delta event has tool and delta', () => {
      const tool: ToolInfo = { id: 't3', name: 'search' };
      const event: AgentEvent = {
        type: 'tool_input_delta',
        tool,
        delta: 'abc',
      };
      if (event.type === 'tool_input_delta') {
        expect(event.delta).toBe('abc');
      }
    });

    it('tool_result event carries output', () => {
      const tool: ToolInfo = { id: 't4', name: 'run_cmd', output: 'ok' };
      const event: AgentEvent = { type: 'tool_result', tool };
      if (event.type === 'tool_result') {
        expect(event.tool.output).toBe('ok');
      }
    });

    it('complete event has content', () => {
      const event: AgentEvent = { type: 'complete', content: 'done' };
      if (event.type === 'complete') {
        expect(event.content).toBe('done');
      }
    });

    it('error event has error message', () => {
      const event: AgentEvent = { type: 'error', error: 'oops' };
      if (event.type === 'error') {
        expect(event.error).toBe('oops');
      }
    });

  });
});

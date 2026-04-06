import type { AgentWrapper } from '@airo/ai-lib';
import { Server as HTTPServer } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSocketServer } from '../experimental-websocket-server.js';
import { createNoOpPersistence } from '../noop-persistence.js';

vi.mock('@airo/ai-lib', () => ({
  createAgentFactory: vi.fn(),
  calculateCostEstimate: vi.fn(),
  formatCostEstimate: vi.fn(),
  getCacheHitRate: vi.fn(),
}));

const mockSocket: Record<string, any> = {
  id: 'test-socket-id',
  emit: vi.fn(),
  on: vi.fn(),
  connected: true,
  data: {},
  handshake: {
    auth: {},
  },
  volatile: {
    emit: vi.fn(),
  },
};

const mockIO = {
  on: vi.fn(),
  close: vi.fn(),
};

vi.mock('socket.io', () => ({
  Server: vi.fn().mockImplementation(() => mockIO),
}));

const mockAgent: AgentWrapper = {
  getName: () => 'test-agent',
  streamGenerate: vi.fn(),
} as any;

const mockAgents = {
  get: vi.fn().mockReturnValue(mockAgent),
  list: vi.fn().mockReturnValue(['test-agent']),
};

async function setupServerWithConnection(
  httpServer: HTTPServer,
  config: { agents: typeof mockAgents; defaultAgent: string; messagePersistence?: any },
): Promise<{ server: WebSocketServer; messageHandler: (data: any) => Promise<void> }> {
  let connectionHandler: ((socket: any) => Promise<void>) | null = null;

  mockIO.on.mockImplementation((event: string, handler: any) => {
    if (event === 'connection') {
      connectionHandler = handler;
    }
  });

  const configWithPersistence = {
    ...config,
    messagePersistence: config.messagePersistence ?? createNoOpPersistence(),
  };

  const server = new WebSocketServer(httpServer, configWithPersistence);

  if (connectionHandler) {
    await connectionHandler(mockSocket);
  }

  const onCall = mockSocket.on.mock.calls.find((call: any[]) => call[0] === 'chat');
  if (!onCall) {
    throw new Error('Chat handler not found after connection setup');
  }

  return { server, messageHandler: onCall[1] };
}

describe('WebSocketServer - message size limits', () => {
  let httpServer: HTTPServer;

  beforeEach(() => {
    vi.clearAllMocks();
    httpServer = new HTTPServer();
  });

  it('rejects chat payloads over 100k characters without calling the agent', async () => {
    const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
    });

    await messageHandler({
      message: 'x'.repeat(100_001),
      agentId: 'test-agent',
    });

    expect(mockAgent.streamGenerate).not.toHaveBeenCalled();
    const errorEmit = mockSocket.emit.mock.calls.find(
      (call: unknown[]) =>
        call[0] === 'message' &&
        (call[1] as { type?: string })?.type === 'error' &&
        String((call[1] as { content?: string }).content).includes('exceeds maximum length limit'),
    );
    expect(errorEmit).toBeDefined();

    testServer.close();
  });

  it('rejects chat when contextAttachments carry oversized referenced_files (message field small)', async () => {
    const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
    });

    await messageHandler({
      message: 'ok',
      agentId: 'test-agent',
      context: {
        metadata: { agentId: 'test-agent' },
        contextAttachments: [
          {
            type: 'referenced_files',
            data: [{ path: 'pasted.txt', content: 'z'.repeat(100_000) }],
            persistence: 'ephemeral',
            renderStrategy: 'before_prompt',
            metadata: { timestamp: Date.now(), source: 'file-reference' },
          },
        ],
      },
    });

    expect(mockAgent.streamGenerate).not.toHaveBeenCalled();
    const errorEmit = mockSocket.emit.mock.calls.find(
      (call: unknown[]) =>
        call[0] === 'message' &&
        (call[1] as { type?: string })?.type === 'error' &&
        String((call[1] as { content?: string }).content).includes('exceeds maximum length limit'),
    );
    expect(errorEmit).toBeDefined();

    testServer.close();
  });

  it('accepts chat when message plus attachment strings are within the combined limit', async () => {
    const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
    });

    // stringPayloadLength counts ALL strings in attachment: type (16), path (1), content,
    // persistence (9), renderStrategy (13), metadata.source (14) = ~53 overhead
    // Plus message 'hi' (2). Stay under 100k: 100_000 - 55 = 99_945 max for content
    const contentLen = 99_900
    await messageHandler({
      message: 'hi',
      agentId: 'test-agent',
      context: {
        metadata: { agentId: 'test-agent' },
        contextAttachments: [
          {
            type: 'referenced_files',
            data: [{ path: 'a', content: 'c'.repeat(contentLen) }],
            persistence: 'ephemeral',
            renderStrategy: 'before_prompt',
            metadata: { timestamp: 1, source: 'file-reference' },
          },
        ],
      },
    });

    expect(mockAgent.streamGenerate).toHaveBeenCalled();

    testServer.close();
  });
});

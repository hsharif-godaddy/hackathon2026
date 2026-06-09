import { createDevelopAgent } from '../develop-agent.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetAgentModelWithName, mockPromptBuilders } = vi.hoisted(() => ({
  mockGetAgentModelWithName: vi.fn(),
  mockPromptBuilders: [] as any[],
}));

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: mockGetAgentModelWithName
}));

vi.mock('../../tools/ai-lib-tools/index.js', () => {
  const tool = { execute: vi.fn() };
  return {
    allAILibTools: new Proxy({}, {
      get: function get() {
        return tool;
      }
    })
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue('')
  };
});

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual('@airo/ai-lib');
  const mockBuilder = function builder() {
    const self: Record<string, any> = { files: [] };
    self.file = vi.fn(function file(path: string) {
      self.files.push(path);
      return self;
    });
    self.text = vi.fn().mockReturnValue(self);
    self.template = vi.fn().mockReturnValue(self);
    self.build = vi.fn().mockResolvedValue(
      '# AI Developer\nYou are a senior web developer.'
    );
    mockPromptBuilders.push(self);
    return self;
  };
  return {
    ...actual,
    createPromptBuilder: mockBuilder,
    createHandoffTool: vi.fn().mockReturnValue({
      execute: vi.fn()
    })
  };
});

describe('develop-agent', function developAgentTests() {
  beforeEach(function setup() {
    mockPromptBuilders.length = 0;
    mockGetAgentModelWithName.mockReset();
    mockGetAgentModelWithName.mockResolvedValue({
      model: { generate: vi.fn(), streamGenerate: vi.fn() },
      modelName: 'claude-sonnet-4-6'
    });
  });

  describe('#createDevelopAgent', function createTests() {
    it('should create agent configuration with correct properties',
      async function create() {
        const config = await createDevelopAgent();

        expect(config.id).toBe('develop');
        expect(config.name).toBe('AI Developer');
        expect(config).toHaveProperty('system');
        expect(config).toHaveProperty('model');
        expect(config).toHaveProperty('modelName');
        expect(config).toHaveProperty('tools');
        expect(config.maxSteps).toBe(100);
        expect(config.temperature).toBe(0.3);
        expect(config.maxOutputTokens).toBe(32000);
      });

    it('should have step timeout configured',
      async function timeout() {
        const config = await createDevelopAgent();

        expect(config.timeout).toEqual({ stepMs: 600_000 });
      });

    it('should rely on model defaults for provider options',
      async function defaults() {
        const config = await createDevelopAgent();

        expect(config.providerOptions).toBeUndefined();
      });

    it('should configure handoff to marketing agent',
      async function handoffs() {
        const config = await createDevelopAgent();

        expect(config.handoffs).toBeInstanceOf(Array);
        expect(config.handoffs).toHaveLength(1);
        expect(config.handoffs[0].agentName).toBe('marketing');
      });

    it('should include core development tools',
      async function coreTools() {
        const config = await createDevelopAgent();

        expect(config.tools).toHaveProperty('directoryListing');
        expect(config.tools).toHaveProperty('terminalCommand');
        expect(config.tools).toHaveProperty(
          'str_replace_based_edit_tool'
        );
        expect(config.tools).toHaveProperty('readFile');
        expect(config.tools).toHaveProperty('grepSearch');
        expect(config.tools).toHaveProperty('todoList');
      });

    it('should enable prompt caching',
      async function promptCaching() {
        const config = await createDevelopAgent();

        expect(config.enablePromptCaching).toBe(true);
      });

    // The system prompt is now built lazily by a resolver in createDevelopAgent.
    // To inspect which prompt files are loaded, we have to invoke the resolver
    // — that's what the AgentWrapper does once per turn inside prepareCall.
    async function fireSystemResolver(config: Awaited<ReturnType<typeof createDevelopAgent>>) {
      if (typeof config.system === 'function') {
        await config.system({});
      }
    }

    it('should include Claude behavior guidance for Claude-family models',
      async function claudeBehavior() {
        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('claude-behavior.md'))).toBe(true);
      });

    it('should omit Claude behavior guidance for non-Anthropic models',
      async function nonAnthropic() {
        mockGetAgentModelWithName.mockResolvedValueOnce({
          model: { generate: vi.fn(), streamGenerate: vi.fn() },
          modelName: 'azure/Kimi-K2.6'
        });

        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('claude-behavior.md'))).toBe(false);
      });

    it('should include Kimi behavior guidance for Kimi models',
      async function kimiBehavior() {
        mockGetAgentModelWithName.mockResolvedValueOnce({
          model: { generate: vi.fn(), streamGenerate: vi.fn() },
          modelName: 'azure/Kimi-K2.6'
        });

        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('kimi-behavior.md'))).toBe(true);
      });

    it('should omit Kimi behavior guidance for Claude models',
      async function claudeModel() {
        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('kimi-behavior.md'))).toBe(false);
      });

    it('should include Kimi behavior guidance for runtime model overrides',
      async function modelOverride() {
        const config = await createDevelopAgent();
        // Fire the lazy resolver to materialize the first builder, then trigger
        // the model-override path which uses systemForModel.
        await fireSystemResolver(config);

        await (config.metadata?.systemForModel as (modelName: string) => Promise<string>)('azure/Kimi-K2.6');

        expect(mockPromptBuilders[1].files.some((path: string) => path.endsWith('kimi-behavior.md'))).toBe(true);
      });

    it('should include Kimi behavior guidance for Kimi thinking variant',
      async function kimiThinkingBehavior() {
        mockGetAgentModelWithName.mockResolvedValueOnce({
          model: { generate: vi.fn(), streamGenerate: vi.fn() },
          modelName: 'azure/Kimi-K2.6-thinking'
        });

        const config = await createDevelopAgent();
        await fireSystemResolver(config);

        expect(mockPromptBuilders[0].files.some((path: string) => path.endsWith('kimi-behavior.md'))).toBe(true);
      });
  });
});

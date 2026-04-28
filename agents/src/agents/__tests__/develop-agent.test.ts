import { createDevelopAgent } from '../develop-agent.js';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'claude-sonnet-4-6'
  })
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue('')
  };
});

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual('@airo/ai-lib');
  const mockBuilder = () => {
    const self: Record<string, any> = {};
    self.file = vi.fn().mockReturnValue(self);
    self.text = vi.fn().mockReturnValue(self);
    self.template = vi.fn().mockReturnValue(self);
    self.build = vi.fn().mockResolvedValue(
      '# AI Developer\nYou are a senior web developer.'
    );
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
  });
});

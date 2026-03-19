import { createInitialAgent } from '../initial-agent.js';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'sonnet'
  })
}));

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual('@airo/ai-lib');
  return {
    ...actual,
    createPromptBuilder: () => ({
      file: vi.fn().mockReturnThis(),
      build: vi.fn().mockResolvedValue('# Initial Agent\nYou are a senior product designer.')
    }),
    createHandoffTool: vi.fn().mockReturnValue({ execute: vi.fn() })
  };
});

describe('initial-agent', function initialAgentTests() {
  describe('#createInitialAgent', function createTests() {
    it('should create agent configuration with correct properties', async function create() {
      const config = await createInitialAgent();

      expect(config.id).toBe('initial');
      expect(config.name).toBe('Initial');
      expect(config).toHaveProperty('system');
      expect(config).toHaveProperty('model');
      expect(config).toHaveProperty('modelName');
      expect(config).toHaveProperty('tools');
      expect(config.maxSteps).toBe(10);
      expect(config.temperature).toBe(0.5);
      expect(config.maxOutputTokens).toBe(8000);
    });

    it('should have maxOutputTokens high enough for handoff payloads', async function outputTokens() {
      const config = await createInitialAgent();

      // 8000 tokens required: the handoff tool call includes a large design
      // direction payload (~800 tokens) plus setProjectName and todoList calls.
      // Values below 4000 cause finishReason:"length" on long user prompts.
      expect(config.maxOutputTokens).toBeGreaterThanOrEqual(4000);
      expect(config.maxOutputTokens).toBe(8000);
    });

    it('should include planning and handoff tools', async function tools() {
      const config = await createInitialAgent();

      expect(config.tools).toHaveProperty('todoList');
      expect(config.tools).toHaveProperty('setProjectName');
      expect(config.tools).toHaveProperty('askQuestion');
      expect(config.tools).toHaveProperty('websiteRebuild');
    });

    it('should not include handoff tool without stateManager', async function noHandoff() {
      const config = await createInitialAgent();

      expect(config.tools).not.toHaveProperty('handoff');
    });

    it('should include handoff tool when stateManager is provided', async function withHandoff() {
      const mockStateManager = {
        switchAgent: vi.fn(),
        getCurrentAgent: vi.fn(),
      };

      const config = await createInitialAgent(mockStateManager as any);

      expect(config.tools).toHaveProperty('handoff');
    });

    it('should configure handoff to develop agent', async function handoffs() {
      const config = await createInitialAgent();

      expect(config.handoffs).toBeInstanceOf(Array);
      expect(config.handoffs).toHaveLength(1);
      expect(config.handoffs[0].agentName).toBe('develop');
    });

    it('should stop after handoff, websiteRebuild, and askQuestion tools', async function stopAfterTools() {
      const mockStateManager = {
        switchAgent: vi.fn(),
        getCurrentAgent: vi.fn(),
      };

      const config = await createInitialAgent(mockStateManager as any);

      expect(config.stopAfterTools).toContain('handoff');
      expect(config.stopAfterTools).toContain('websiteRebuild');
      expect(config.stopAfterTools).toContain('askQuestion');
    });

    it('should use effort:low provider option for concise planning', async function effort() {
      const config = await createInitialAgent();

      expect(config.providerOptions).toEqual({
        anthropic: { effort: 'low' }
      });
    });

    it('should enable prompt caching', async function caching() {
      const config = await createInitialAgent();

      expect(config.enablePromptCaching).toBe(true);
    });

    it('should configure metadata context preferences', async function metadata() {
      const config = await createInitialAgent();

      expect(config.metadata).toHaveProperty('contextPreferences');
      const prefs = (config.metadata as any).contextPreferences;
      expect(prefs.includeAppContext).toBe(true);
      expect(prefs.includeVisualContext).toBe(false);
      expect(prefs.includeConversationHistory).toBe(true);
      expect(prefs.includeTemplateDescription).toBe(true);
    });

    it('should have step timeout configured', async function timeout() {
      const config = await createInitialAgent();

      expect(config.timeout).toEqual({ stepMs: 60_000 });
    });
  });
});

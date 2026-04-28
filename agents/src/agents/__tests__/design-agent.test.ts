import { createDesignAgent, createDesignAgentFactory, DesignAgent } from '../design-agent.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock model selection to avoid API key requirement in CI
vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'claude-sonnet-4-5-20250929'
  })
}));

describe('design-agent', function designAgentTests() {
  describe('#createDesignAgent', function createTests() {
    it('should create agent configuration with correct properties', async function create() {
      const config = await createDesignAgent();

      expect(config.name).toBe('Design System Creator');
      expect(config).toHaveProperty('system');
      expect(config).toHaveProperty('model');
      expect(config).toHaveProperty('modelName');
      expect(config).toHaveProperty('tools');
      expect(config.temperature).toBe(0.7);
      expect(config.maxSteps).toBe(20);
      expect(config.maxOutputTokens).toBe(4000);
    });

    it('should include memory tools', async function memoryTools() {
      const config = await createDesignAgent();

      expect(config.tools).toHaveProperty('memorySet');
      expect(config.tools).toHaveProperty('memoryRead');
      expect(config.tools).toHaveProperty('memorySearch');
      expect(config.tools).toHaveProperty('memoryListKeys');
    });

    it('should include file operation tools', async function fileTools() {
      const config = await createDesignAgent();

      expect(config.tools).toHaveProperty('readFile');
      expect(config.tools).toHaveProperty('directoryListing');
    });

    it('should configure handoff to develop agent', async function handoffs() {
      const config = await createDesignAgent();

      expect(config.handoffs).toBeInstanceOf(Array);
      expect(config.handoffs).toHaveLength(1);
      expect(config.handoffs[0].agentName).toBe('develop');
      expect(config.handoffs[0]).toHaveProperty('description');
    });

    it('should have afterToolExecution hook', async function hooks() {
      const config = await createDesignAgent();

      expect(config.afterToolExecution).toBeInstanceOf(Function);
    });

    it('should have higher temperature for creative work', async function temperature() {
      const config = await createDesignAgent();

      // Design agent should have higher temperature (0.7) vs develop agent (0.3)
      expect(config.temperature).toBe(0.7);
    });

    it('should have step timeout configured', async function timeout() {
      const config = await createDesignAgent();

      expect(config.timeout).toEqual({ stepMs: 600_000 });
    });

    it('should rely on model defaults for provider options', async function defaults() {
      const config = await createDesignAgent();

      expect(config.providerOptions).toBeUndefined();
    });
  });

  describe('#createDesignAgentFactory', function factoryTests() {
    it('should create factory with design agent', async function factory() {
      const { factory, agents, getAgent } = await createDesignAgentFactory();

      expect(factory).toBeTypeOf('object');
      expect(agents).toBeTypeOf('object');
      expect(getAgent).toBeInstanceOf(Function);
    });

    it('should return design agent from getAgent', async function getAgent() {
      const { getAgent } = await createDesignAgentFactory();
      const agent = getAgent();

      expect(agent).toBeTypeOf('object');
      expect(agent.getName).toBeInstanceOf(Function);
    });
  });

  describe('DesignAgent', function classTests() {
    let agent: DesignAgent;

    beforeEach(function setup() {
      agent = new DesignAgent();
    });

    it('should throw error if getAgent called before initialize', function notInitialized() {
      expect(() => agent.getAgent()).toThrow('Agent not initialized');
    });

    it('should throw error if getFactory called before initialize', function factoryNotInitialized() {
      expect(() => agent.getFactory()).toThrow('Agent not initialized');
    });

    it('should throw error if getConfig called before initialize', function configNotInitialized() {
      expect(() => agent.getConfig()).toThrow('Agent not initialized');
    });

    it('should initialize successfully', async function initialize() {
      await agent.initialize();
      const agentInstance = agent.getAgent();

      expect(agentInstance).toBeTypeOf('object');
    });

    it('should return agent name after initialization', async function getName() {
      await agent.initialize();
      const name = agent.getName();

      expect(name).toBe('Design System Creator');
    });

    it('should return config after initialization', async function getConfig() {
      await agent.initialize();
      const config = agent.getConfig();

      expect(config.name).toBe('Design System Creator');
      expect(config).toHaveProperty('tools');
    });

    it('should have streamGenerate method', async function streamGenerate() {
      await agent.initialize();

      expect(agent.streamGenerate).toBeInstanceOf(Function);
    });

    it('should have generate method', async function generate() {
      await agent.initialize();

      expect(agent.generate).toBeInstanceOf(Function);
    });

    it('should have handoffToDevelop method', async function handoff() {
      await agent.initialize();

      expect(agent.handoffToDevelop).toBeInstanceOf(Function);
    });

    it('should have cleanup method', async function cleanup() {
      await agent.initialize();
      await agent.cleanup();

      // cleanup should complete without error
      expect(true).toBe(true);
    });
  });

  describe('#systemPrompt', function promptTests() {
    it('should load system prompt from modular files', async function loadPrompt() {
      const config = await createDesignAgent();
      const systemPrompt = config.system;

      expect(systemPrompt).toBeTypeOf('string');
      expect(systemPrompt.length).toBeGreaterThan(0);
    });

    it('should include design agent core identity', async function coreIdentity() {
      const config = await createDesignAgent();
      const systemPrompt = config.system;

      expect(systemPrompt).toContain('Design System Creator');
    });

    it('should reference 8 design sections', async function sections() {
      const config = await createDesignAgent();
      const systemPrompt = config.system;

      // Should mention all 8 sections
      expect(systemPrompt).toContain('Brand Personality');
      expect(systemPrompt).toContain('Color Palette');
      expect(systemPrompt).toContain('Typography');
      expect(systemPrompt).toContain('Iconography');
      expect(systemPrompt).toContain('Layout');
      expect(systemPrompt).toContain('Voice & Messaging');
      expect(systemPrompt).toContain('Features');
      expect(systemPrompt).toContain('Site Map');
    });

    it('should emphasize brevity', async function brevity() {
      const config = await createDesignAgent();
      const systemPrompt = config.system;

      expect(systemPrompt).toContain('brief');
      expect(systemPrompt).toContain('concise');
    });

    it('should include memory tool usage', async function memoryUsage() {
      const config = await createDesignAgent();
      const systemPrompt = config.system;

      expect(systemPrompt).toContain('memorySet');
      expect(systemPrompt).toContain('memoryRead');
      expect(systemPrompt).toContain('design.');
    });
  });

  describe('#tools', function toolsTests() {
    it('should have exactly 6 tools configured', async function toolCount() {
      const config = await createDesignAgent();
      const toolNames = Object.keys(config.tools);

      expect(toolNames).toHaveLength(6);
    });

    it('should prioritize memory tools over file edit', async function memoryPriority() {
      const config = await createDesignAgent();

      // Design agent should use memory, not file editing
      expect(config.tools).toHaveProperty('memorySet');
      expect(config.tools).not.toHaveProperty('fileEdit');
    });

    it('should not include terminal or git tools', async function noSystemTools() {
      const config = await createDesignAgent();

      // Design agent doesn't need system modification tools
      expect(config.tools).not.toHaveProperty('terminalCommand');
      expect(config.tools).not.toHaveProperty('gitOperation');
    });

    it('should not include image generation tools', async function noImageTools() {
      const config = await createDesignAgent();

      // Design agent creates documentation, not images
      expect(config.tools).not.toHaveProperty('imageGenerate');
      expect(config.tools).not.toHaveProperty('imageSearch');
    });
  });

  describe('#configuration', function configTests() {
    it('should use full model for comprehensive design work', async function modelSelection() {
      const config = await createDesignAgent();

      // Should use full model, not fast
      expect(config.modelName).toContain('sonnet');
    });

    it('should have appropriate max steps for design work', async function maxSteps() {
      const config = await createDesignAgent();

      // 20 steps should be enough for creating 8 sections
      expect(config.maxSteps).toBe(20);
    });

    it('should have sufficient output tokens for design sections', async function outputTokens() {
      const config = await createDesignAgent();

      // 4000 tokens should handle all sections
      expect(config.maxOutputTokens).toBe(4000);
    });
  });
});


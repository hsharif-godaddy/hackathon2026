import { createMarketingAgent, createMarketingAgentFactory, MarketingAgent } from '../marketing-agent.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock model selection to avoid API key requirement
vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'claude-sonnet-4-6'
  })
}));

// Mock prompt builder
vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual('@airo/ai-lib');
  return {
    ...actual,
    createPromptBuilder: () => ({
      file: vi.fn().mockReturnThis(),
      text: vi.fn().mockReturnThis(),
      build: vi.fn().mockResolvedValue(`# Airo Marketer

You are an expert Airo Marketer focused on SEO and search engine optimization.

## Workflow
- You receive handoff from develop agent
- NEVER edit code files
- You are a strategist

## Modern SEO
- Answer Engine Optimization for AI assistants`)
    })
  };
});

describe('marketing-agent', function marketingAgentTests() {
  describe('#createMarketingAgent', function createTests() {
    it('should create agent configuration with correct properties', async function create() {
      const config = await createMarketingAgent();

      expect(config.name).toBe('Airo Marketer');
      expect(config).toHaveProperty('system');
      expect(config).toHaveProperty('model');
      expect(config).toHaveProperty('modelName');
      expect(config).toHaveProperty('tools');
      expect(config.temperature).toBe(0.4);
      expect(config.maxSteps).toBe(50);
      expect(config.maxOutputTokens).toBe(8000);
    });

    it('should include SEO and file operation tools', async function seoTools() {
      const config = await createMarketingAgent();

      expect(config.tools).toHaveProperty('seoAnalysis');
      expect(config.tools).toHaveProperty('readFile');
      expect(config.tools).toHaveProperty('str_replace_based_edit_tool');
      expect(config.tools).toHaveProperty('todoList');
      expect(config.tools).toHaveProperty('directoryListing');
      expect(config.tools).toHaveProperty('grepSearch');
      expect(config.tools).toHaveProperty('media');
      expect(config.tools).toHaveProperty('suggestedResponse');
      expect(config.tools).toHaveProperty('skill');
    });

    it('should configure handoff to develop agent', async function handoffs() {
      const config = await createMarketingAgent();

      expect(config.handoffs).toBeInstanceOf(Array);
      expect(config.handoffs).toHaveLength(1);
      expect(config.handoffs[0].agentName).toBe('develop');
      expect(config.handoffs[0]).toHaveProperty('description');
    });

    it('should have appropriate temperature for analytical work', async function temperature() {
      const config = await createMarketingAgent();

      // Marketing agent should have moderate temperature (0.4)
      expect(config.temperature).toBe(0.4);
    });

    it('should have step timeout configured', async function timeout() {
      const config = await createMarketingAgent();

      expect(config.timeout).toEqual({ stepMs: 600_000 });
    });

    it('should use effort:low provider option for latency', async function effort() {
      const config = await createMarketingAgent();

      expect(config.providerOptions).toEqual({
        anthropic: { effort: 'low' }
      });
    });

    it('should configure metadata preferences', async function metadata() {
      const config = await createMarketingAgent();

      expect(config.metadata).toHaveProperty('contextPreferences');
      expect(config.metadata.contextPreferences.includeAppContext).toBe(true);
      expect(config.metadata.contextPreferences.includeVisualContext).toBe(true);
      expect(config.metadata.contextPreferences.includeConversationHistory).toBe(true);
      expect(config.metadata.contextPreferences.includeTemplateDescription).toBe(true);
    });
  });

  describe('#createMarketingAgentFactory', function factoryTests() {
    it('should create factory with marketing agent', async function factory() {
      const { factory, agents, getAgent } = await createMarketingAgentFactory();

      expect(factory).toBeTypeOf('object');
      expect(agents).toBeTypeOf('object');
      expect(getAgent).toBeInstanceOf(Function);
    });

    it('should return marketing agent from getAgent', async function getAgent() {
      const { getAgent } = await createMarketingAgentFactory();
      const agent = getAgent();

      expect(agent).toBeTypeOf('object');
      expect(agent.getName).toBeInstanceOf(Function);
    });

    it('should add handoff tool when sessionId provided', async function handoffTool() {
      const { getAgent } = await createMarketingAgentFactory({
        sessionId: 'test-session-123'
      });
      const agent = getAgent();
      const config = agent.getConfig();

      expect(config.tools).toHaveProperty('handoff');
    });

    it('should accept custom state manager', async function stateManager() {
      const mockStateManager = {
        updateState: vi.fn(),
        getState: vi.fn(),
        clearState: vi.fn()
      };

      const { stateManager } = await createMarketingAgentFactory({
        stateManager: mockStateManager as any
      });

      expect(stateManager).toBe(mockStateManager);
    });
  });

  describe('MarketingAgent', function classTests() {
    let agent: MarketingAgent;

    beforeEach(function setup() {
      agent = new MarketingAgent();
    });

    it('should throw error if getAgent called before initialize', function notInitialized() {
      expect(() => agent.getAgent()).toThrow('Agent not initialized');
    });

    it('should initialize successfully', async function initialize() {
      await agent.initialize();
      const agentInstance = agent.getAgent();

      expect(agentInstance).toBeTypeOf('object');
    });

    it('should return agent name after initialization', async function getName() {
      await agent.initialize();
      const name = agent.getName();

      expect(name).toBe('Airo Marketer');
    });

    it('should have streamGenerate method', async function streamGenerate() {
      await agent.initialize();

      expect(agent.streamGenerate).toBeInstanceOf(Function);
    });

    it('should have generate method', async function generate() {
      await agent.initialize();

      expect(agent.generate).toBeInstanceOf(Function);
    });

    it('should have cleanup method', async function cleanup() {
      await agent.initialize();
      await agent.cleanup();

      // cleanup should complete without error
      expect(true).toBe(true);
    });

    it('should accept sessionId in constructor', async function sessionId() {
      const agentWithSession = new MarketingAgent({
        sessionId: 'test-session-456'
      });
      await agentWithSession.initialize();

      const agentInstance = agentWithSession.getAgent();
      expect(agentInstance).toBeTruthy();
    });

    it('should accept custom appPath', async function appPath() {
      const customPath = '/custom/app/path';
      const agentWithPath = new MarketingAgent({
        appPath: customPath
      });
      await agentWithPath.initialize();

      // Agent should initialize with custom path
      expect(agentWithPath).toBeTruthy();
    });
  });

  describe('#systemPrompt', function promptTests() {
    it('should load system prompt from modular files', async function loadPrompt() {
      const config = await createMarketingAgent();
      const systemPrompt = config.system;

      expect(systemPrompt).toBeTypeOf('string');
      expect(systemPrompt.length).toBeGreaterThan(0);
    });

    it('should include marketing agent core identity', async function coreIdentity() {
      const config = await createMarketingAgent();
      const systemPrompt = config.system;

      expect(systemPrompt).toContain('Airo Marketer');
    });

    it('should reference SEO analysis capabilities', async function seoCapabilities() {
      const config = await createMarketingAgent();
      const systemPrompt = config.system;

      expect(systemPrompt).toContain('SEO');
      expect(systemPrompt).toContain('search engine optimization');
    });

    it('should include handoff workflow', async function handoffWorkflow() {
      const config = await createMarketingAgent();
      const systemPrompt = config.system;

      expect(systemPrompt).toContain('handoff');
      expect(systemPrompt).toContain('develop agent');
    });

    it('should emphasize strategic analysis over coding', async function strategicFocus() {
      const config = await createMarketingAgent();
      const systemPrompt = config.system;

      expect(systemPrompt).toContain('NEVER edit code files');
      expect(systemPrompt).toContain('strategist');
    });

    it('should include AEO and GEO considerations', async function modernSEO() {
      const config = await createMarketingAgent();
      const systemPrompt = config.system;

      expect(systemPrompt).toContain('Answer Engine Optimization');
      expect(systemPrompt).toContain('AI assistants');
    });
  });

  describe('#tools', function toolsTests() {
    it('should have exactly 9 tools configured', async function toolCount() {
      const config = await createMarketingAgent();
      const toolNames = Object.keys(config.tools);

      expect(toolNames).toHaveLength(9);
    });

    it('should include seoAnalysis tool', async function seoTool() {
      const config = await createMarketingAgent();

      expect(config.tools).toHaveProperty('seoAnalysis');
      expect(config.tools.seoAnalysis).toBeTruthy();
    });

    it('should not include terminal or git tools', async function noSystemTools() {
      const config = await createMarketingAgent();

      // Marketing agent doesn't need system modification tools
      expect(config.tools).not.toHaveProperty('terminalCommand');
      expect(config.tools).not.toHaveProperty('gitOperation');
    });

    it('should not include server management tools', async function noServerTools() {
      const config = await createMarketingAgent();

      expect(config.tools).not.toHaveProperty('serverRestart');
      expect(config.tools).not.toHaveProperty('serverStatus');
    });

    it('should include file reading but limited editing', async function fileTools() {
      const config = await createMarketingAgent();

      // Should be able to read files and create reports
      expect(config.tools).toHaveProperty('readFile');
      expect(config.tools).toHaveProperty('str_replace_based_edit_tool');
      expect(config.tools).toHaveProperty('directoryListing');
      expect(config.tools).toHaveProperty('grepSearch');
    });
  });

  describe('#configuration', function configTests() {
    it('should use full model for comprehensive analysis', async function modelSelection() {
      const config = await createMarketingAgent();

      // Should use full model for analysis work
      expect(config.modelName).toBeTypeOf('string');
    });

    it('should have high max steps for thorough analysis', async function maxSteps() {
      const config = await createMarketingAgent();

      // 50 steps allows for comprehensive SEO analysis
      expect(config.maxSteps).toBe(50);
    });

    it('should have large output tokens for detailed reports', async function outputTokens() {
      const config = await createMarketingAgent();

      // 8000 tokens for comprehensive reports
      expect(config.maxOutputTokens).toBe(8000);
    });
  });
});
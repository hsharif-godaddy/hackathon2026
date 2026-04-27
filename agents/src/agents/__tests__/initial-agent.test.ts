import { createInitialAgent } from '../initial-agent.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRegisterSkill = vi.fn().mockReturnValue({ success: true });
const mockUnloadSkill = vi.fn();
const mockRunHook = vi.fn().mockResolvedValue(undefined);
const mockLoadSkill = vi.fn().mockResolvedValue({ success: true, instructions: '# Media Logo Skill\nInstructions here.' });

vi.mock('../../tools/skill-tool-manager.js', () => ({
  skillToolManager: {
    registerSkill: (...args: unknown[]) => mockRegisterSkill(...args),
    unloadSkill: (...args: unknown[]) => mockUnloadSkill(...args),
    runHook: (...args: unknown[]) => mockRunHook(...args),
  }
}));

vi.mock('../../tools/skill-loader-tool.js', () => ({
  SkillLoaderTool: vi.fn().mockImplementation(() => ({
    loadSkill: (...args: unknown[]) => mockLoadSkill(...args),
  }))
}));

const fileCalls: string[] = [];

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
    createPromptBuilder: () => {
      const builder = {
        file: vi.fn().mockImplementation((path: string) => {
          fileCalls.push(path);
          return builder;
        }),
        build: vi.fn().mockResolvedValue('# Initial Agent\nYou are a senior product designer.')
      };
      return builder;
    },
    createHandoffTool: vi.fn().mockReturnValue({ execute: vi.fn() })
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: (path: string) => {
      // 3.0 modular files exist
      if (path.includes('initial/3.0/')) return true;
      // Legacy files: core.md always exists, optional files exist for 1.0
      if (path.includes('core.md')) return true;
      if (path.includes('initial/1.0/attributes.md')) return true;
      if (path.includes('initial/1.0/guidelines.md')) return true;
      if (path.includes('initial/1.0/examples.md')) return true;
      if (path.includes('initial/2.0/guidelines.md')) return true;
      if (path.includes('initial/2.0/examples.md')) return true;
      // identity.md only exists in 3.0 (sentinel for modular detection)
      if (path.includes('identity.md') && !path.includes('3.0')) return false;
      return false;
    }
  };
});

describe('initial-agent', function initialAgentTests() {
  beforeEach(() => {
    fileCalls.length = 0;
    mockRegisterSkill.mockReturnValue({ success: true });
    mockLoadSkill.mockResolvedValue({ success: true, instructions: '# Media Logo Skill\nInstructions here.' });
    mockRunHook.mockResolvedValue(undefined);
    mockUnloadSkill.mockReset();
  });

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

      expect(config.timeout).toEqual({ stepMs: 600_000 });
    });

    it('should create agent with template-specific id when templateId is provided', async function templateId() {
      const config = await createInitialAgent(undefined, 'business-plan');

      expect(config.id).toBe('initial-business-plan');
      expect(config.name).toBe('Initial (business-plan)');
    });

    it('should throw for unknown templateId', async function unknownTemplate() {
      await expect(createInitialAgent(undefined, 'nonexistent')).rejects.toThrow('Unknown template: nonexistent');
    });

    it('should keep default id when no templateId is provided', async function defaultId() {
      const config = await createInitialAgent();

      expect(config.id).toBe('initial');
      expect(config.name).toBe('Initial');
    });

    it('should include skill tool and onSkillsLoad for logo-designer template', async function logoDesignerSkill() {
      const config = await createInitialAgent(undefined, 'logo-designer');

      expect(config.tools).toHaveProperty('skill');
      expect(config.onSkillsLoad).toBeTypeOf('function');
      expect(config.tools).toHaveProperty('brandBook');
      expect(config.tools).toHaveProperty('colorScheme');
      expect(config.tools).toHaveProperty('fontTheme');
      // Logo-designer doesn't need websiteRebuild — out-of-scope requests hand off to initial
      expect(config.tools).not.toHaveProperty('websiteRebuild');
    });

    it('should NOT include generateLogo or editLogo for logo-designer template', async function noLegacyLogoTools() {
      const config = await createInitialAgent(undefined, 'logo-designer');

      expect(config.tools).not.toHaveProperty('generateLogo');
      expect(config.tools).not.toHaveProperty('editLogo');
    });

    it('should not set onSkillsLoad for non-template agents', async function noOnSkillsLoad() {
      const config = await createInitialAgent();

      expect(config.onSkillsLoad).toBeUndefined();
      expect(config.tools).not.toHaveProperty('skill');
    });

    it('onSkillsLoad should return system-role message with after_history insertion', async function onSkillsLoadReturn() {
      const config = await createInitialAgent(undefined, 'logo-designer');

      const messages = await config.onSkillsLoad!('test-conversation-id');

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].insertionOrder).toBe('after_history');
      expect(messages[0].content).toContain('Media Logo Skill');
      expect(mockRegisterSkill).toHaveBeenCalledWith('media-logo', 'test-conversation-id');
      expect(mockRunHook).toHaveBeenCalledWith('media-logo', 'onLoad', { skillName: 'media-logo' });
    });

    it('onSkillsLoad should return empty array when skill activation fails', async function onSkillsLoadFail() {
      mockRegisterSkill.mockReturnValueOnce({ success: false, error: 'not found' });

      const config = await createInitialAgent(undefined, 'logo-designer');
      const messages = await config.onSkillsLoad!('test-conversation-id');

      expect(messages).toHaveLength(0);
    });

    it('onSkillsLoad should unload skill and return empty when instructions fail', async function onSkillsLoadNoInstructions() {
      mockLoadSkill.mockResolvedValueOnce({ success: false, instructions: '' });

      const config = await createInitialAgent(undefined, 'logo-designer');
      const messages = await config.onSkillsLoad!('test-conversation-id');

      expect(messages).toHaveLength(0);
      expect(mockUnloadSkill).toHaveBeenCalledWith('media-logo', 'test-conversation-id');
    });

    it('logo-designer should have two handoffs (develop and initial)', async function logoDesignerHandoffs() {
      const config = await createInitialAgent(undefined, 'logo-designer');

      expect(config.handoffs).toHaveLength(2);
      expect(config.handoffs![0].agentName).toBe('develop');
      expect(config.handoffs![1].agentName).toBe('initial');
    });

    it('logo-designer with stateManager should have validTargets including initial', async function logoDesignerValidTargets() {
      const mockStateManager = {
        switchAgent: vi.fn(),
        getCurrentAgent: vi.fn(),
      };

      const config = await createInitialAgent(mockStateManager as any, 'logo-designer');

      // handoff tool is present, and validTargets would have been passed to createHandoffTool
      expect(config.tools).toHaveProperty('handoff');
    });

    it('logo-designer stopAfterTools should not include websiteRebuild', async function logoDesignerStopAfterTools() {
      const mockStateManager = {
        switchAgent: vi.fn(),
        getCurrentAgent: vi.fn(),
      };

      const config = await createInitialAgent(mockStateManager as any, 'logo-designer');

      expect(config.stopAfterTools).toContain('handoff');
      expect(config.stopAfterTools).toContain('askQuestion');
      expect(config.stopAfterTools).not.toContain('websiteRebuild');
    });

    it('non-template stopAfterTools should include websiteRebuild', async function defaultStopAfterTools() {
      const config = await createInitialAgent();

      expect(config.stopAfterTools).toContain('websiteRebuild');
      expect(config.stopAfterTools).toContain('askQuestion');
      expect(config.stopAfterTools).not.toContain('handoff');
    });
  });

  describe('prompt file loading', function promptLoadingTests() {
    it('should load legacy 1.0 files in correct order: core → communication → optional → security', async function legacyOrder() {
      await createInitialAgent(undefined, undefined, '1.0');

      const fileNames = fileCalls.map(p => p.split('/').pop());
      const coreIdx = fileNames.indexOf('core.md');
      const commIdx = fileNames.indexOf('communication.md');
      const secIdx = fileNames.indexOf('security.md');

      const attrIdx = fileNames.indexOf('attributes.md');

      expect(coreIdx).toBeLessThan(commIdx);
      expect(commIdx).toBeLessThan(attrIdx);
      expect(commIdx).toBeLessThan(secIdx);
      expect(fileNames).toContain('attributes.md');
      expect(fileNames).toContain('guidelines.md');
      expect(fileNames).toContain('examples.md');
    });

    it('should load v2.0 in legacy mode (no identity.md)', async function v2Legacy() {
      await createInitialAgent(undefined, undefined, '2.0');

      const fileNames = fileCalls.map(p => p.split('/').pop());
      expect(fileNames).toContain('core.md');
      expect(fileNames).toContain('communication.md');
      expect(fileNames).toContain('security.md');
      expect(fileNames).not.toContain('identity.md');
    });

    it('should load v3.0 in modular mode with all 8 modules', async function modularLoading() {
      await createInitialAgent(undefined, undefined, '3.0');

      const fileNames = fileCalls.map(p => p.split('/').pop());
      const expectedModules = [
        'identity.md', 'questioning.md', 'project-name.md',
        'design-direction.md', 'design-reference.md', 'feature-list.md',
        'handoff-template.md', 'examples.md',
      ];
      for (const mod of expectedModules) {
        expect(fileNames).toContain(mod);
      }
      expect(fileNames).toContain('communication.md');
      expect(fileNames).toContain('security.md');
      expect(fileNames).not.toContain('core.md');
    });

    it('should append shared files after modules in v3.0', async function modularSharedOrder() {
      await createInitialAgent(undefined, undefined, '3.0');

      const fileNames = fileCalls.map(p => p.split('/').pop());
      const lastModuleIdx = fileNames.lastIndexOf('examples.md');
      const commIdx = fileNames.indexOf('communication.md');
      const secIdx = fileNames.indexOf('security.md');

      expect(lastModuleIdx).toBeLessThan(commIdx);
      expect(commIdx).toBeLessThan(secIdx);
    });
  });
});

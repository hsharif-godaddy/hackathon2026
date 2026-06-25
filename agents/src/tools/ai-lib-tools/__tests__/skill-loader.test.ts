/**
 * Tests for skillAITool hook invocations
 *
 * Verifies that runHook is called at the correct lifecycle points
 * (onLoad, onInstall, onUnload) with the correct context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// Hoisted mocks for use inside vi.mock factories
const { mockRunHook, mockRegisterSkill, mockUnloadSkill, mockLoadSkill, mockListSkills, mockInstallTemplates, mockFindById, mockIsSkillAvailableInMarket, mockEmitSkillAction, mockCreateSkillAction, mockRecordInstall, mockRecordComplete } = vi.hoisted(() => ({
  mockRunHook: vi.fn().mockResolvedValue(undefined),
  mockRegisterSkill: vi.fn().mockReturnValue({ success: true, tools: ['test__tool1'] }),
  mockUnloadSkill: vi.fn().mockReturnValue(true),
  mockLoadSkill: vi.fn().mockResolvedValue({ success: true, skill: 'test-skill', instructions: 'test instructions' }),
  mockListSkills: vi.fn().mockResolvedValue({ success: true, skills: [] }),
  mockInstallTemplates: vi.fn().mockResolvedValue({ success: true, skill: 'test-skill', filesInstalled: 1, installedFiles: ['file.ts'] }),
  mockFindById: vi.fn().mockReturnValue({ path: '/tmp/apps/test-app' }),
  mockIsSkillAvailableInMarket: vi.fn().mockResolvedValue(true),
  mockEmitSkillAction: vi.fn(),
  mockCreateSkillAction: vi.fn().mockReturnValue({ schemaId: 'test-schema', data: {} }),
  mockRecordInstall: vi.fn(),
  mockRecordComplete: vi.fn(),
}));

vi.mock('@godaddy/agent-otel-sdk', () => ({
  emitSkillAction: mockEmitSkillAction,
}));

vi.mock('@godaddy/agent-observability-events', () => ({
  createSkillAction: mockCreateSkillAction,
}));

vi.mock('../../applied-skills-registry.js', () => ({
  appliedSkillsRegistry: {
    recordInstall: mockRecordInstall,
    recordComplete: mockRecordComplete,
  },
}));

vi.mock('../../skill-tool-manager.js', () => ({
  skillToolManager: {
    runHook: mockRunHook,
    registerSkill: mockRegisterSkill,
    unloadSkill: mockUnloadSkill,
    isPinned: vi.fn().mockReturnValue(false),
    getPinnedSkills: vi.fn().mockReturnValue([])
  }
}));

vi.mock('../../skill-loader-tool.js', () => ({
  SkillLoaderTool: vi.fn().mockImplementation(function () { return {
    loadSkill: mockLoadSkill,
    listSkills: mockListSkills,
    installTemplates: mockInstallTemplates,
    isSkillAvailableInMarket: mockIsSkillAvailableInMarket
  }; })
}));

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: mockFindById
  }; })
}));

// Import after mocks
const { skillAITool } = await import('../skill-loader.js');

/** Helper to execute the tool with given input and context */
async function executeTool(input: Record<string, unknown>, context?: Record<string, unknown>) {
  // The AI SDK tool wraps execute; access it directly
  const toolObj = skillAITool as any;
  return toolObj.execute(input, { experimental_context: context });
}

const mockContext = {
  metadata: {
    conversationId: 'conv-123',
    appId: 'app-456'
  }
};

describe('skillAITool hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterSkill.mockReturnValue({ success: true, tools: ['test__tool1'] });
    mockUnloadSkill.mockReturnValue(true);
    mockLoadSkill.mockResolvedValue({ success: true, skill: 'test-skill', instructions: 'test instructions' });
    mockInstallTemplates.mockResolvedValue({ success: true, skill: 'test-skill', filesInstalled: 1, installedFiles: ['file.ts'] });
    mockFindById.mockReturnValue({ path: '/tmp/apps/test-app' });
    mockCreateSkillAction.mockReturnValue({ schemaId: 'test-schema', data: {} });
  });

  describe('load action', () => {
    it('should call runHook with onLoad after successful load', async () => {
      await executeTool({ action: 'load', skill: 'authentication' }, mockContext);

      expect(mockRunHook).toHaveBeenCalledWith('authentication', 'onLoad', {
        skillName: 'authentication',
        appPath: '/tmp/apps/test-app',
        appId: 'app-456'
      });
    });

    it('should call onLoad hook even when tool registration fails', async () => {
      mockRegisterSkill.mockReturnValue({ success: false, tools: [], error: 'no tools' });

      await executeTool({ action: 'load', skill: 'authentication' }, mockContext);

      expect(mockRunHook).toHaveBeenCalledWith('authentication', 'onLoad', expect.objectContaining({
        skillName: 'authentication'
      }));
    });

    it('should call onLoad hook even without conversationId', async () => {
      await executeTool({ action: 'load', skill: 'authentication' }, { metadata: { appId: 'app-456' } });

      expect(mockRunHook).toHaveBeenCalledWith('authentication', 'onLoad', expect.objectContaining({
        skillName: 'authentication',
        appId: 'app-456'
      }));
    });

    it('should forward market from context metadata to loadSkill', async () => {
      const contextWithMarket = {
        metadata: {
          conversationId: 'conv-123',
          appId: 'app-456',
          market: 'en-US',
        }
      };

      await executeTool({ action: 'load', skill: 'authentication' }, contextWithMarket);

      expect(mockLoadSkill).toHaveBeenCalledWith(
        expect.objectContaining({ skill: 'authentication', market: 'en-US' })
      );
    });

    it('should pass undefined market to loadSkill when context has no market', async () => {
      await executeTool({ action: 'load', skill: 'authentication' }, mockContext);

      expect(mockLoadSkill).toHaveBeenCalledWith(
        expect.objectContaining({ skill: 'authentication', market: undefined })
      );
    });

    it('should pass contextMetadata to loadSkill for switchboard gating', async () => {
      const context = {
        metadata: { conversationId: 'conv-123', appId: 'app-456', marketingCampaignsEnabled: true }
      };

      await executeTool({ action: 'load', skill: 'marketing-campaigns' }, context);

      expect(mockLoadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skill: 'marketing-campaigns',
          contextMetadata: expect.objectContaining({ marketingCampaignsEnabled: true }),
        })
      );
    });

    it('should propagate loadSkill failure when switchboard flag blocks', async () => {
      mockLoadSkill.mockResolvedValueOnce({ success: false, skill: 'marketing-campaigns', error: "Skill 'marketing-campaigns' is not available." });

      const context = {
        metadata: { conversationId: 'conv-123', appId: 'app-456', marketingCampaignsEnabled: false }
      };

      await expect(executeTool({ action: 'load', skill: 'marketing-campaigns' }, context))
        .rejects.toThrow('not available');
    });

    it('should pass contextMetadata to loadSkill for google-business-profile-sync switchboard gating', async () => {
      const context = {
        metadata: { conversationId: 'conv-123', appId: 'app-456', googleBusinessProfileSyncEnabled: true }
      };

      await executeTool({ action: 'load', skill: 'google-business-profile-sync' }, context);

      expect(mockLoadSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skill: 'google-business-profile-sync',
          contextMetadata: expect.objectContaining({ googleBusinessProfileSyncEnabled: true }),
        })
      );
    });
  });

  describe('unload action', () => {
    it('should call runHook with onUnload after successful unload', async () => {
      await executeTool({ action: 'unload', skill: 'authentication' }, mockContext);

      expect(mockRunHook).toHaveBeenCalledWith('authentication', 'onUnload', {
        skillName: 'authentication',
        appId: 'app-456'
      });
    });

    it('should not call onUnload hook when unload returns false', async () => {
      mockUnloadSkill.mockReturnValue(false);

      await executeTool({ action: 'unload', skill: 'authentication' }, mockContext);

      expect(mockRunHook).not.toHaveBeenCalled();
    });
  });

  describe('install action', () => {
    it('should call runHook with onInstall after successful install', async () => {
      await executeTool({ action: 'install', skill: 'authentication' }, mockContext);

      expect(mockRunHook).toHaveBeenCalledWith('authentication', 'onInstall', {
        skillName: 'authentication',
        appPath: '/tmp/apps/test-app',
        appId: 'app-456'
      });
    });
  });

  describe('list action', () => {
    it('should not call runHook for list action', async () => {
      await executeTool({ action: 'list' }, mockContext);

      expect(mockRunHook).not.toHaveBeenCalled();
    });

    it('should forward market from context metadata to listSkills', async () => {
      const contextWithMarket = {
        metadata: {
          conversationId: 'conv-123',
          appId: 'app-456',
          market: 'en-US',
        }
      };

      await executeTool({ action: 'list' }, contextWithMarket);

      expect(mockListSkills).toHaveBeenCalledWith(
        expect.objectContaining({ market: 'en-US' })
      );
    });

    it('should pass undefined market when context has no market', async () => {
      await executeTool({ action: 'list' }, mockContext);

      expect(mockListSkills).toHaveBeenCalledWith(
        expect.objectContaining({ market: undefined })
      );
    });

    it('should pass undefined market when context metadata market is not a string', async () => {
      const contextWithBadMarket = {
        metadata: {
          conversationId: 'conv-123',
          appId: 'app-456',
          market: 42,
        }
      };

      await executeTool({ action: 'list' }, contextWithBadMarket);

      expect(mockListSkills).toHaveBeenCalledWith(
        expect.objectContaining({ market: undefined })
      );
    });
  });

  describe('pin action - market rejection', () => {
    it('should reject pin when isSkillAvailableInMarket returns false', async () => {
      mockIsSkillAvailableInMarket.mockResolvedValueOnce(false);

      const context = {
        metadata: { conversationId: 'conv-123', appId: 'app-456', market: 'ja-JP' }
      };

      const result = await executeTool({ action: 'pin', skill: 'compliance-docs' }, context);

      expect(result).toEqual(expect.objectContaining({
        success: false,
        message: expect.stringContaining('not available in your market'),
      }));
    });
  });

  describe('install action - market rejection', () => {
    it('should throw when isSkillAvailableInMarket returns false', async () => {
      mockIsSkillAvailableInMarket.mockResolvedValueOnce(false);

      const context = {
        metadata: { conversationId: 'conv-123', appId: 'app-456', market: 'ja-JP' }
      };

      await expect(executeTool({ action: 'install', skill: 'compliance-docs' }, context))
        .rejects.toThrow('not available in your market');
    });
  });

  describe('complete action', () => {
    it('returns success and marks the skill as complete', async function completeSuccess() {
      const result = await executeTool({ action: 'complete', skill: 'authentication' }, mockContext);

      expect(result).toEqual(expect.objectContaining({
        success: true,
        skill: 'authentication',
      }));
    });

    it('calls recordComplete on the registry with the skill name and app path', async function callsRecordComplete() {
      await executeTool({ action: 'complete', skill: 'authentication' }, mockContext);

      expect(mockRecordComplete).toHaveBeenCalledWith('authentication', '/tmp/apps/test-app');
    });

    it('throws when appId is missing from context', async function requiresAppId() {
      await expect(
        executeTool({ action: 'complete', skill: 'authentication' }, { metadata: { conversationId: 'conv-123' } })
      ).rejects.toThrow('App ID not found in context');
    });

    it('throws when the app cannot be found in the repository', async function appNotFound() {
      mockFindById.mockReturnValueOnce(undefined);

      await expect(
        executeTool({ action: 'complete', skill: 'authentication' }, mockContext)
      ).rejects.toThrow('App not found');
    });
  });

  describe('emitSkillAction calls', () => {
    it('emits load event after successful load', async function emitLoad() {
      await executeTool({ action: 'load', skill: 'authentication' }, mockContext);

      expect(mockCreateSkillAction).toHaveBeenCalledWith(
        expect.objectContaining({ skillName: 'authentication', skillAction: 'load' })
      );
      expect(mockEmitSkillAction).toHaveBeenCalledTimes(1);
    });

    it('emits unload event after successful unload', async function emitUnload() {
      await executeTool({ action: 'unload', skill: 'authentication' }, mockContext);

      expect(mockCreateSkillAction).toHaveBeenCalledWith(
        expect.objectContaining({ skillName: 'authentication', skillAction: 'unload' })
      );
      expect(mockEmitSkillAction).toHaveBeenCalledTimes(1);
    });

    it('does not emit an event when unload fails (skill not loaded)', async function noEmitOnFailedUnload() {
      mockUnloadSkill.mockReturnValueOnce(false);

      await executeTool({ action: 'unload', skill: 'authentication' }, mockContext);

      expect(mockEmitSkillAction).not.toHaveBeenCalled();
    });

    it('emits install event after successful install', async function emitInstall() {
      await executeTool({ action: 'install', skill: 'authentication' }, mockContext);

      expect(mockCreateSkillAction).toHaveBeenCalledWith(
        expect.objectContaining({ skillName: 'authentication', skillAction: 'install' })
      );
      expect(mockEmitSkillAction).toHaveBeenCalledTimes(1);
    });

    it('emits complete event after recording complete', async function emitComplete() {
      await executeTool({ action: 'complete', skill: 'authentication' }, mockContext);

      expect(mockCreateSkillAction).toHaveBeenCalledWith(
        expect.objectContaining({ skillName: 'authentication', skillAction: 'complete' })
      );
      expect(mockEmitSkillAction).toHaveBeenCalledTimes(1);
    });

    it('passes the createSkillAction result as eventData to emitSkillAction', async function eventDataPropagation() {
      const fakeEventData = { schemaId: 'urn:skill-action', data: { skillName: 'authentication' } };
      mockCreateSkillAction.mockReturnValueOnce(fakeEventData);

      await executeTool({ action: 'load', skill: 'authentication' }, mockContext);

      expect(mockEmitSkillAction).toHaveBeenCalledWith({ eventData: fakeEventData });
    });

    it('does not throw when emitSkillAction throws on load', async function guardLoad() {
      mockEmitSkillAction.mockImplementationOnce(() => { throw new Error('OTel unavailable'); });

      await expect(executeTool({ action: 'load', skill: 'authentication' }, mockContext))
        .resolves.toMatchObject({ skill: 'test-skill' });
    });

    it('does not throw when emitSkillAction throws on install', async function guardInstall() {
      mockEmitSkillAction.mockImplementationOnce(() => { throw new Error('OTel unavailable'); });

      await expect(executeTool({ action: 'install', skill: 'authentication' }, mockContext))
        .resolves.toMatchObject({ skill: 'test-skill' });
    });

    it('does not throw when emitSkillAction throws on complete', async function guardComplete() {
      mockEmitSkillAction.mockImplementationOnce(() => { throw new Error('OTel unavailable'); });

      await expect(executeTool({ action: 'complete', skill: 'authentication' }, mockContext))
        .resolves.toMatchObject({ success: true, skill: 'authentication' });
    });
  });
});

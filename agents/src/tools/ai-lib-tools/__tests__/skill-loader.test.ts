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
const { mockRunHook, mockRegisterSkill, mockUnloadSkill, mockLoadSkill, mockListSkills, mockInstallTemplates, mockFindById } = vi.hoisted(() => ({
  mockRunHook: vi.fn().mockResolvedValue(undefined),
  mockRegisterSkill: vi.fn().mockReturnValue({ success: true, tools: ['test__tool1'] }),
  mockUnloadSkill: vi.fn().mockReturnValue(true),
  mockLoadSkill: vi.fn().mockResolvedValue({ success: true, skill: 'test-skill', instructions: 'test instructions' }),
  mockListSkills: vi.fn().mockResolvedValue({ success: true, skills: [] }),
  mockInstallTemplates: vi.fn().mockResolvedValue({ success: true, skill: 'test-skill', filesInstalled: 1, installedFiles: ['file.ts'] }),
  mockFindById: vi.fn().mockReturnValue({ path: '/tmp/apps/test-app' })
}));

vi.mock('../../skill-tool-manager.js', () => ({
  skillToolManager: {
    runHook: mockRunHook,
    registerSkill: mockRegisterSkill,
    unloadSkill: mockUnloadSkill
  }
}));

vi.mock('../../skill-loader-tool.js', () => ({
  SkillLoaderTool: vi.fn().mockImplementation(() => ({
    loadSkill: mockLoadSkill,
    listSkills: mockListSkills,
    installTemplates: mockInstallTemplates
  }))
}));

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: mockFindById
  }))
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
  });
});

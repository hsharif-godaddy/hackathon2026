import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../../tools/app-plan-tool.js', () => ({
  appPlanTool: {
    execute: vi.fn()
  }
}));
vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));
vi.mock('../../logging/events/index.js', () => ({
  appContextEvents: {
    generateBegin: vi.fn(),
    generateSuccess: vi.fn(),
    generateFailure: vi.fn(),
    packageBegin: vi.fn(),
    packageSuccess: vi.fn(),
    packageFailure: vi.fn()
  }
}));
vi.mock('../../tools/directory-listing.js', () => ({
  DirectoryListingTool: vi.fn().mockImplementation(() => ({
    listDirectory: vi.fn().mockResolvedValue('')
  }))
}));
vi.mock('../../tools/secrets-management-tool.js', () => ({
  SecretsManagementTool: vi.fn()
}));
vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp: vi.fn().mockReturnValue(null)
  }
}));
vi.mock('../MediaManifestService.js', () => ({
  mediaManifestService: {
    getManifest: vi.fn().mockResolvedValue({ success: false })
  }
}));
vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockReturnValue(null)
  }))
}));
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('not found'))
}));
vi.mock('child_process', () => ({
  execFile: vi.fn()
}));

import { AppContextManager } from '../AppContextManager.js';
import { appPlanTool } from '../../tools/app-plan-tool.js';

describe('AppContextManager design system', () => {
  let manager: AppContextManager;
  const mockExecute = vi.mocked(appPlanTool.execute);

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AppContextManager();
  });

  describe('formatDesignSystemSection', () => {
    // Access private method via type assertion for testing
    const callFormat = (manager: any, info: any) => manager.formatDesignSystemSection(info);

    it('should return "not configured" when no design info', () => {
      const result = callFormat(manager, null);
      expect(result).toBe('Design System: Not configured');
    });

    it('should show color scheme when only colors configured', () => {
      const result = callFormat(manager, {
        colorPalette: { name: 'Ocean Blue', primary: '#0066cc', secondary: '#004499', accent: '#00aaff' },
        fontTheme: null
      });

      expect(result).toContain('Color Scheme: Name: Ocean Blue');
      expect(result).toContain('Primary: #0066cc');
      expect(result).toContain('Secondary: #004499');
      expect(result).toContain('Accent: #00aaff');
      expect(result).not.toContain('Font Theme:');
    });

    it('should show font theme when only fonts configured', () => {
      const result = callFormat(manager, {
        colorPalette: null,
        fontTheme: {
          name: 'Modern Professional',
          headerFont: { name: 'Montserrat', weights: ['600', '700'], category: 'sans-serif' },
          bodyFont: { name: 'Inter', weights: ['400', '500'], category: 'sans-serif' }
        }
      });

      expect(result).toContain('Color Scheme: Not configured');
      expect(result).toContain('Font Theme: Theme: Modern Professional');
      expect(result).toContain('Headers: Montserrat');
      expect(result).toContain('Body: Inter');
    });

    it('should show both color scheme and font theme when both configured', () => {
      const result = callFormat(manager, {
        colorPalette: { name: 'Ocean Blue', primary: '#0066cc' },
        fontTheme: {
          name: 'Elegant Serif',
          headerFont: { name: 'Playfair Display', weights: ['600'], category: 'serif' },
          bodyFont: { name: 'Lora', weights: ['400'], category: 'serif' }
        }
      });

      expect(result).toContain('Color Scheme: Name: Ocean Blue');
      expect(result).toContain('Font Theme: Theme: Elegant Serif');
      expect(result).toContain('Headers: Playfair Display');
      expect(result).toContain('Body: Lora');
    });

    it('should handle font theme without name', () => {
      const result = callFormat(manager, {
        colorPalette: null,
        fontTheme: {
          headerFont: { name: 'Roboto', weights: ['700'], category: 'sans-serif' },
          bodyFont: { name: 'Open Sans', weights: ['400'], category: 'sans-serif' }
        }
      });

      expect(result).toContain('Font Theme: Headers: Roboto, Body: Open Sans');
    });
  });

  describe('getDesignSystemInfo', () => {
    const callGet = async (manager: any, appId: string) => manager.getDesignSystemInfo(appId);

    it('should return both colorPalette and fontTheme from app plan', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        data: {
          appId: 'test',
          createdAt: new Date(),
          updatedAt: new Date(),
          colorPalette: { name: 'Test', primary: '#000' } as any,
          fontTheme: {
            name: 'Test Font',
            headerFont: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
            bodyFont: { name: 'Inter', weights: ['400'], category: 'sans-serif' }
          }
        }
      });

      const result = await callGet(manager, 'test');

      expect(result).toEqual({
        colorPalette: { name: 'Test', primary: '#000' },
        fontTheme: {
          name: 'Test Font',
          headerFont: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
          bodyFont: { name: 'Inter', weights: ['400'], category: 'sans-serif' }
        }
      });
    });

    it('should return fontTheme even without colorPalette', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        data: {
          appId: 'test',
          createdAt: new Date(),
          updatedAt: new Date(),
          fontTheme: {
            name: 'Test',
            headerFont: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
            bodyFont: { name: 'Inter', weights: ['400'], category: 'sans-serif' }
          }
        }
      });

      const result = await callGet(manager, 'test');

      expect(result).toEqual({
        colorPalette: null,
        fontTheme: {
          name: 'Test',
          headerFont: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
          bodyFont: { name: 'Inter', weights: ['400'], category: 'sans-serif' }
        }
      });
    });

    it('should return null when neither colorPalette nor fontTheme exist', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        data: {
          appId: 'test',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      const result = await callGet(manager, 'test');
      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockExecute.mockRejectedValue(new Error('db error'));

      const result = await callGet(manager, 'test');
      expect(result).toBeNull();
    });
  });
});

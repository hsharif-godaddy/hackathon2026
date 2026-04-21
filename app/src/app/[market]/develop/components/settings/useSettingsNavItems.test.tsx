/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsSection } from '@/app/[market]/develop/components/types';
import { SwitchboardAuthError } from '@/hooks/useSwitchboard';
import { renderHookWithProviders } from '@/tests/test-utils';
import { useSettingsNavItems } from './useSettingsNavItems';

const mockDevelopStore = {
  openFeedbackModal: vi.fn(),
  isMobile: false,
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));

const mockSwitchboardResults: Record<string, { data: any; error: any }> = {};

vi.mock('@/hooks/useSwitchboard', () => {
  class SwitchboardAuthErrorImpl extends Error {
    constructor(featureName: string) {
      super(`Authentication required to fetch feature flag: ${featureName}`);
      this.name = 'SwitchboardAuthError';
    }
  }
  return {
    SwitchboardAuthError: SwitchboardAuthErrorImpl,
    useSwitchboard: (feature: string) => {
      if (mockSwitchboardResults[feature]) return mockSwitchboardResults[feature];
      if (feature === 'appbuilder-settings-project') return { data: true, error: null };
      if (feature === 'appbuilder-settings-domain') return { data: true, error: null };
      if (feature === 'appbuilder-settings-backups') return { data: true, error: null };
      if (feature === 'appbuilder-settings-security') return { data: true, error: null };
      if (feature === 'appbuilder-settings-secrets') return { data: true, error: null };
      if (feature === 'appbuilder-settings-visualscan') return { data: false, error: null };
      return { data: false, error: null };
    },
  };
});

describe('useSettingsNavItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.isMobile = false;
    localStorage.clear();
    // Clear per-test overrides
    for (const key of Object.keys(mockSwitchboardResults)) {
      delete mockSwitchboardResults[key];
    }
  });

  it('should return array of settings nav items', () => {
    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    expect(result.current).toBeInstanceOf(Array);
    expect(result.current.length).toBeGreaterThan(0);
  });

  it('should include project settings item', () => {
    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const projectItem = result.current.find(item => item.id === SettingsSection.PROJECT);
    expect(projectItem).toBeDefined();
    expect(projectItem?.label).toBe('builder_settings_nav_project');
    expect(projectItem?.disabled).toBe(false);
  });

  it('should include domain item', () => {
    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const domainItem = result.current.find(item => item.id === SettingsSection.DOMAIN);
    expect(domainItem).toBeDefined();
    expect(domainItem?.label).toBe('builder_settings_nav_domain');
    expect(domainItem?.disabled).toBe(false);
  });

  it('should include backups item', () => {
    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const backupsItem = result.current.find(item => item.id === SettingsSection.BACKUPS);
    expect(backupsItem).toBeDefined();
    expect(backupsItem?.label).toBe('builder_settings_nav_backups');
    expect(backupsItem?.disabled).toBe(false);
  });

  it('should include security item', () => {
    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const securityItem = result.current.find(item => item.id === SettingsSection.SECURITY);
    expect(securityItem).toBeDefined();
    expect(securityItem?.label).toBe('builder_settings_nav_security');
    expect(securityItem?.disabled).toBe(false);
  });

  it('should include database item', () => {
    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const databaseItem = result.current.find(item => item.id === SettingsSection.DATABASE);
    expect(databaseItem).toBeDefined();
    expect(databaseItem?.label).toBe('builder_settings_nav_database');
    expect(databaseItem?.disabled).toBe(false);
  });

  it('should include secrets item', () => {
    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const secretsItem = result.current.find(item => item.id === SettingsSection.SECRETS);
    expect(secretsItem).toBeDefined();
    expect(secretsItem?.label).toBe('builder_settings_nav_secrets');
    expect(secretsItem?.disabled).toBe(false);
  });

  it('should not include visual scan when disabled', () => {
    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const visualScanItem = result.current.find(item => item.id === SettingsSection.VISUAL_SCAN);
    expect(visualScanItem).toBeUndefined();
  });

  it('should include feedback item on desktop', () => {
    mockDevelopStore.isMobile = false;

    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const feedbackItem = result.current.find(item => item.id === SettingsSection.FEEDBACK);
    expect(feedbackItem).toBeDefined();
    expect(feedbackItem?.label).toBe('builder_settings_nav_feedback');
    expect(feedbackItem?.disabled).toBe(false);
  });

  it('should include feedback item on mobile', () => {
    mockDevelopStore.isMobile = true;

    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const feedbackItem = result.current.find(item => item.id === SettingsSection.FEEDBACK);
    expect(feedbackItem).toBeDefined();
    expect(feedbackItem?.label).toBe('builder_settings_nav_feedback');
    expect(feedbackItem?.disabled).toBe(false);
  });

  it('should have onClick handler for feedback item', () => {
    mockDevelopStore.isMobile = false;

    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const feedbackItem = result.current.find(item => item.id === SettingsSection.FEEDBACK);
    expect(feedbackItem?.onClick).toBeDefined();
    expect(typeof feedbackItem?.onClick).toBe('function');
  });

  it('should call openFeedbackModal when feedback onClick called', () => {
    mockDevelopStore.isMobile = false;
    const openFeedbackModal = vi.fn();
    mockDevelopStore.openFeedbackModal = openFeedbackModal;

    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const feedbackItem = result.current.find(item => item.id === SettingsSection.FEEDBACK);
    feedbackItem?.onClick?.();

    expect(openFeedbackModal).toHaveBeenCalledWith('airo#app-builder', 'Settings');
  });

  it('should clear localStorage when feedback onClick called', () => {
    mockDevelopStore.isMobile = false;
    localStorage.setItem('airo-feedback-shown:airo#app-builder', 'true');

    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const feedbackItem = result.current.find(item => item.id === SettingsSection.FEEDBACK);
    feedbackItem?.onClick?.();

    expect(localStorage.getItem('airo-feedback-shown:airo#app-builder')).toBeNull();
  });

  it('should have icons for all items', () => {
    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    result.current.forEach(item => {
      expect(item.icon).toBeDefined();
    });
  });

  it('should not have onClick for non-feedback items', () => {
    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const projectItem = result.current.find(item => item.id === SettingsSection.PROJECT);
    expect(projectItem?.onClick).toBeUndefined();
  });

  describe('SwitchboardAuthError handling', () => {
    it('should set needsAuth=true and disabled=false when switchboard returns auth error', () => {
      mockSwitchboardResults['appbuilder-settings-project'] = {
        data: undefined,
        error: new SwitchboardAuthError('appbuilder-settings-project'),
      };

      const { result } = renderHookWithProviders(() => useSettingsNavItems());

      const projectItem = result.current.find(item => item.id === SettingsSection.PROJECT);
      expect(projectItem?.needsAuth).toBe(true);
      expect(projectItem?.disabled).toBe(false);
    });

    it('should set needsAuth on multiple items with auth errors', () => {
      mockSwitchboardResults['appbuilder-settings-domain'] = {
        data: undefined,
        error: new SwitchboardAuthError('appbuilder-settings-domain'),
      };
      mockSwitchboardResults['appbuilder-settings-secrets'] = {
        data: undefined,
        error: new SwitchboardAuthError('appbuilder-settings-secrets'),
      };

      const { result } = renderHookWithProviders(() => useSettingsNavItems());

      const domainItem = result.current.find(item => item.id === SettingsSection.DOMAIN);
      expect(domainItem?.needsAuth).toBe(true);
      expect(domainItem?.disabled).toBe(false);

      const secretsItem = result.current.find(item => item.id === SettingsSection.SECRETS);
      expect(secretsItem?.needsAuth).toBe(true);
      expect(secretsItem?.disabled).toBe(false);
    });

    it('should show conditional items with needsAuth when auth error occurs', () => {
      mockSwitchboardResults['appbuilder-settings-social'] = {
        data: undefined,
        error: new SwitchboardAuthError('appbuilder-settings-social'),
      };
      mockSwitchboardResults['appbuilder-settings-marketing'] = {
        data: undefined,
        error: new SwitchboardAuthError('appbuilder-settings-marketing'),
      };

      const { result } = renderHookWithProviders(() => useSettingsNavItems());

      const socialItem = result.current.find(item => item.id === SettingsSection.SOCIAL);
      expect(socialItem).toBeDefined();
      expect(socialItem?.needsAuth).toBe(true);

      const marketingItem = result.current.find(item => item.id === SettingsSection.MARKETING);
      expect(marketingItem).toBeDefined();
      expect(marketingItem?.needsAuth).toBe(true);
    });

    it('should not set needsAuth when error is null', () => {
      const { result } = renderHookWithProviders(() => useSettingsNavItems());

      const projectItem = result.current.find(item => item.id === SettingsSection.PROJECT);
      expect(projectItem?.needsAuth).toBeFalsy();
    });
  });
});

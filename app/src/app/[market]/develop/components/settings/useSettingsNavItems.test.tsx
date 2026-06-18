/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsSection } from '@/app/[market]/develop/components/types';
import { renderHookWithProviders } from '@/tests/test-utils';
import { useSettingsNavItems } from './useSettingsNavItems';

const mockDevelopStore = {
  openFeedbackModal: vi.fn(),
  isMobile: false,
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));

const mockSwitchboardResults: Record<string, boolean | undefined> = {};

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => {
    if (feature in mockSwitchboardResults) return mockSwitchboardResults[feature];
    if (feature === 'appbuilder-settings-project') return true;
    if (feature === 'appbuilder-settings-domain') return true;
    if (feature === 'appbuilder-settings-backups') return true;
    if (feature === 'appbuilder-settings-security') return true;
    if (feature === 'appbuilder-settings-secrets') return true;
    if (feature === 'appbuilder-settings-visualscan') return false;
    if (feature === 'appbuilder-settings-display-ads') return false;
    return false;
  },
}));

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

  it('should not include domain item on desktop when top-level domain tab is enabled', () => {
    mockDevelopStore.isMobile = false;
    mockSwitchboardResults['appbuilder-domain-top-level'] = true;

    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const domainItem = result.current.find(item => item.id === SettingsSection.DOMAIN);
    expect(domainItem).toBeUndefined();
  });

  it('should include domain item on mobile', () => {
    mockDevelopStore.isMobile = true;

    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const domainItem = result.current.find(item => item.id === SettingsSection.DOMAIN);
    expect(domainItem).toBeDefined();
    expect(domainItem?.label).toBe('builder_domain_title');
    expect(domainItem?.disabled).toBe(false);
    expect(domainItem?.onClick).toBeUndefined();
  });

  it('should be 2nd item (after General) on mobile', () => {
    mockDevelopStore.isMobile = true;

    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    expect(result.current[0].id).toBe(SettingsSection.PROJECT);
    expect(result.current[1].id).toBe(SettingsSection.DOMAIN);
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

  it('should define the display ads settings section route value', () => {
    expect(SettingsSection.DISPLAY_ADS).toBe('displayAds');
  });

  it('should include display ads when the switchboard flag is enabled', () => {
    mockSwitchboardResults['appbuilder-settings-display-ads'] = true;

    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const displayAdsItem = result.current.find(item => item.id === SettingsSection.DISPLAY_ADS);
    expect(displayAdsItem).toBeDefined();
    expect(displayAdsItem?.label).toBe('builder_settings_nav_display_ads');
    expect(displayAdsItem?.disabled).toBe(false);
  });

  it('should not include display ads when the switchboard flag is explicitly false', () => {
    mockSwitchboardResults['appbuilder-settings-display-ads'] = false;

    const { result } = renderHookWithProviders(() => useSettingsNavItems());

    const displayAdsItem = result.current.find(item => item.id === SettingsSection.DISPLAY_ADS);
    expect(displayAdsItem).toBeUndefined();
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

  describe('domain nav item vs appbuilder-domain-top-level', () => {
    function hasDomainItem(items: ReturnType<typeof useSettingsNavItems>) {
      return items.some((item) => item.id === SettingsSection.DOMAIN);
    }

    it('mobile + flag ON → domain item present', () => {
      mockDevelopStore.isMobile = true;
      mockSwitchboardResults['appbuilder-domain-top-level'] = true;

      const { result } = renderHookWithProviders(() => useSettingsNavItems());

      expect(hasDomainItem(result.current)).toBe(true);
    });

    it('mobile + flag OFF → domain item present', () => {
      mockDevelopStore.isMobile = true;
      mockSwitchboardResults['appbuilder-domain-top-level'] = false;

      const { result } = renderHookWithProviders(() => useSettingsNavItems());

      expect(hasDomainItem(result.current)).toBe(true);
    });

    it('mobile + flag undefined → domain item present', () => {
      mockDevelopStore.isMobile = true;
      mockSwitchboardResults['appbuilder-domain-top-level'] = undefined;

      const { result } = renderHookWithProviders(() => useSettingsNavItems());

      expect(hasDomainItem(result.current)).toBe(true);
    });

    it('desktop + flag ON → domain item NOT present', () => {
      mockDevelopStore.isMobile = false;
      mockSwitchboardResults['appbuilder-domain-top-level'] = true;

      const { result } = renderHookWithProviders(() => useSettingsNavItems());

      expect(hasDomainItem(result.current)).toBe(false);
    });

    it('desktop + flag OFF → domain item present', () => {
      mockDevelopStore.isMobile = false;
      mockSwitchboardResults['appbuilder-domain-top-level'] = false;

      const { result } = renderHookWithProviders(() => useSettingsNavItems());

      expect(hasDomainItem(result.current)).toBe(true);
    });

    it('desktop + flag undefined → domain item present', () => {
      mockDevelopStore.isMobile = false;
      mockSwitchboardResults['appbuilder-domain-top-level'] = undefined;

      const { result } = renderHookWithProviders(() => useSettingsNavItems());

      expect(hasDomainItem(result.current)).toBe(true);
    });
  });

});

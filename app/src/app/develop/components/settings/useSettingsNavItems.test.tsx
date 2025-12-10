import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSettingsNavItems } from './useSettingsNavItems';
import { SettingsSection } from '@/app/develop/components/types';

const mockDevelopStore = {
  openFeedbackModal: vi.fn(),
  isMobile: false,
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => {
    if (feature === 'appbuilder-settings-project') return { data: true };
    if (feature === 'appbuilder-settings-domain') return { data: true };
    if (feature === 'appbuilder-settings-backups') return { data: true };
    if (feature === 'appbuilder-settings-security') return { data: true };
    if (feature === 'appbuilder-settings-database') return { data: true };
    if (feature === 'appbuilder-settings-secrets') return { data: true };
    if (feature === 'appbuilder-settings-visualscan') return { data: false };
    return { data: false };
  },
}));

describe('useSettingsNavItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.isMobile = false;
    localStorage.clear();
  });

  it('should return array of settings nav items', () => {
    const { result } = renderHook(() => useSettingsNavItems());

    expect(result.current).toBeInstanceOf(Array);
    expect(result.current.length).toBeGreaterThan(0);
  });

  it('should include project settings item', () => {
    const { result } = renderHook(() => useSettingsNavItems());

    const projectItem = result.current.find(item => item.id === SettingsSection.PROJECT);
    expect(projectItem).toBeDefined();
    expect(projectItem?.label).toBe('Project Settings');
    expect(projectItem?.disabled).toBe(false);
  });

  it('should include domain item', () => {
    const { result } = renderHook(() => useSettingsNavItems());

    const domainItem = result.current.find(item => item.id === SettingsSection.DOMAIN);
    expect(domainItem).toBeDefined();
    expect(domainItem?.label).toBe('Domain');
    expect(domainItem?.disabled).toBe(false);
  });

  it('should include backups item', () => {
    const { result } = renderHook(() => useSettingsNavItems());

    const backupsItem = result.current.find(item => item.id === SettingsSection.BACKUPS);
    expect(backupsItem).toBeDefined();
    expect(backupsItem?.label).toBe('Backups');
    expect(backupsItem?.disabled).toBe(false);
  });

  it('should include security item', () => {
    const { result } = renderHook(() => useSettingsNavItems());

    const securityItem = result.current.find(item => item.id === SettingsSection.SECURITY);
    expect(securityItem).toBeDefined();
    expect(securityItem?.label).toBe('Security');
    expect(securityItem?.disabled).toBe(false);
  });

  it('should include database item', () => {
    const { result } = renderHook(() => useSettingsNavItems());

    const databaseItem = result.current.find(item => item.id === SettingsSection.DATABASE);
    expect(databaseItem).toBeDefined();
    expect(databaseItem?.label).toBe('Database');
    expect(databaseItem?.disabled).toBe(false);
  });

  it('should include secrets item', () => {
    const { result } = renderHook(() => useSettingsNavItems());

    const secretsItem = result.current.find(item => item.id === SettingsSection.SECRETS);
    expect(secretsItem).toBeDefined();
    expect(secretsItem?.label).toBe('Secrets');
    expect(secretsItem?.disabled).toBe(false);
  });

  it('should not include visual scan when disabled', () => {
    const { result } = renderHook(() => useSettingsNavItems());

    const visualScanItem = result.current.find(item => item.id === SettingsSection.VISUAL_SCAN);
    expect(visualScanItem).toBeUndefined();
  });

  it('should include feedback item on desktop', () => {
    mockDevelopStore.isMobile = false;

    const { result } = renderHook(() => useSettingsNavItems());

    const feedbackItem = result.current.find(item => item.id === SettingsSection.FEEDBACK);
    expect(feedbackItem).toBeDefined();
    expect(feedbackItem?.label).toBe('Give Feedback');
    expect(feedbackItem?.disabled).toBe(false);
  });

  it('should not include feedback item on mobile', () => {
    mockDevelopStore.isMobile = true;

    const { result } = renderHook(() => useSettingsNavItems());

    const feedbackItem = result.current.find(item => item.id === SettingsSection.FEEDBACK);
    expect(feedbackItem).toBeUndefined();
  });

  it('should have onClick handler for feedback item', () => {
    mockDevelopStore.isMobile = false;

    const { result } = renderHook(() => useSettingsNavItems());

    const feedbackItem = result.current.find(item => item.id === SettingsSection.FEEDBACK);
    expect(feedbackItem?.onClick).toBeDefined();
    expect(typeof feedbackItem?.onClick).toBe('function');
  });

  it('should call openFeedbackModal when feedback onClick called', () => {
    mockDevelopStore.isMobile = false;
    const openFeedbackModal = vi.fn();
    mockDevelopStore.openFeedbackModal = openFeedbackModal;

    const { result } = renderHook(() => useSettingsNavItems());

    const feedbackItem = result.current.find(item => item.id === SettingsSection.FEEDBACK);
    feedbackItem?.onClick?.();

    expect(openFeedbackModal).toHaveBeenCalledWith('airo#app-builder');
  });

  it('should clear localStorage when feedback onClick called', () => {
    mockDevelopStore.isMobile = false;
    localStorage.setItem('airo-feedback-shown:airo#app-builder', 'true');

    const { result } = renderHook(() => useSettingsNavItems());

    const feedbackItem = result.current.find(item => item.id === SettingsSection.FEEDBACK);
    feedbackItem?.onClick?.();

    expect(localStorage.getItem('airo-feedback-shown:airo#app-builder')).toBeNull();
  });

  it('should have icons for all items', () => {
    const { result } = renderHook(() => useSettingsNavItems());

    result.current.forEach(item => {
      expect(item.icon).toBeDefined();
    });
  });

  it('should not have onClick for non-feedback items', () => {
    const { result } = renderHook(() => useSettingsNavItems());

    const projectItem = result.current.find(item => item.id === SettingsSection.PROJECT);
    expect(projectItem?.onClick).toBeUndefined();
  });
});

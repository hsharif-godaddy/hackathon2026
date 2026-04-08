/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { ChatTab, SettingsSection } from '@/app/develop/components/types';
import { SwitchboardAuthError } from '@/hooks/useSwitchboard';
import { renderWithProviders } from '@/tests/test-utils';
import SettingsPane from './SettingsPane';

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

const mockDevelopStore = {
  openFeedbackModal: vi.fn(),
  isMobile: false,
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));

const mockSetActiveSettingsSection = vi.fn();
const mockChatTabs = {
  activeChatTab: ChatTab.SETTINGS,
  setActiveChatTab: vi.fn(),
  activeSettingsSection: SettingsSection.PROJECT,
  setActiveSettingsSection: mockSetActiveSettingsSection,
};

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => mockChatTabs,
}));

const mockSetNeedsReauth = vi.fn();
vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: Object.assign(
    () => ({}),
    { getState: () => ({ setNeedsReauth: mockSetNeedsReauth }) },
  ),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

describe('SettingsPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatTabs.activeChatTab = ChatTab.SETTINGS;
    mockChatTabs.activeSettingsSection = SettingsSection.PROJECT;
    for (const key of Object.keys(mockSwitchboardResults)) {
      delete mockSwitchboardResults[key];
    }
  });

  it('should render nav items', () => {
    renderWithProviders(<SettingsPane />);

    expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
    expect(screen.getByText('builder_settings_nav_domain')).toBeInTheDocument();
  });

  it('should navigate when clicking a normal item', async () => {
    const { user } = renderWithProviders(<SettingsPane />);

    await user.click(screen.getByText('builder_settings_nav_domain'));

    expect(mockSetActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.DOMAIN);
    expect(mockSetNeedsReauth).not.toHaveBeenCalled();
  });

  it('should trigger reauth when clicking needsAuth item', async () => {
    mockSwitchboardResults['appbuilder-settings-project'] = {
      data: undefined,
      error: new SwitchboardAuthError('appbuilder-settings-project'),
    };

    const { user } = renderWithProviders(<SettingsPane />);

    await user.click(screen.getByText('builder_settings_nav_project'));

    expect(mockSetNeedsReauth).toHaveBeenCalledWith('session_expired');
    expect(mockSetActiveSettingsSection).not.toHaveBeenCalled();
  });
});

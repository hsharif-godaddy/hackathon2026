/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { ChatTab, SettingsSection } from '@/app/develop/components/types';
import { SwitchboardAuthError } from '@/hooks/useSwitchboard';
import { renderWithProviders } from '@/tests/test-utils';
import SettingsMenu from './SettingsMenu';

const mockDevelopStore = {
  openFeedbackModal: vi.fn(),
  isMobile: false,
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));

const mockChatTabs = {
  activeChatTab: ChatTab.SETTINGS,
  setActiveChatTab: vi.fn(),
  activeSettingsSection: SettingsSection.PROJECT,
  setActiveSettingsSection: vi.fn(),
};

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => mockChatTabs,
}));

const mockSwitchboardResults: Record<string, { data: any; error: any }> = {};

vi.mock('@/hooks/useSwitchboard', () => {
  class SwitchboardAuthError extends Error {
    constructor(featureName: string) {
      super(`Authentication required to fetch feature flag: ${featureName}`);
      this.name = 'SwitchboardAuthError';
    }
  }
  return {
    SwitchboardAuthError,
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

describe('SettingsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatTabs.activeChatTab = ChatTab.SETTINGS;
    mockChatTabs.activeSettingsSection = SettingsSection.PROJECT;
    mockDevelopStore.isMobile = false;
    mockDevelopStore.openFeedbackModal.mockReset();
    for (const key of Object.keys(mockSwitchboardResults)) {
      delete mockSwitchboardResults[key];
    }
  });

  it('should render without crashing', () => {
    const { container } = renderWithProviders(<SettingsMenu />);

    expect(container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!).toBeInTheDocument();
  });

  it('should render settings trigger button', () => {
    const { container } = renderWithProviders(<SettingsMenu />);

    const button = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    expect(button).toBeInTheDocument();
  });

  it('should open popover when trigger button clicked', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
    });
  });

  it('should display all settings options when open', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
      expect(screen.getByText('builder_settings_nav_domain')).toBeInTheDocument();
      expect(screen.getByText('builder_settings_nav_backups')).toBeInTheDocument();
      expect(screen.getByText('builder_settings_nav_security')).toBeInTheDocument();
      expect(screen.getByText('builder_settings_nav_database')).toBeInTheDocument();
      expect(screen.getByText('builder_settings_nav_secrets')).toBeInTheDocument();
    });
  });

  it('should display feedback option on desktop', async () => {
    mockChatTabs.activeSettingsSection = SettingsSection.PROJECT;
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
    });
  });

  it('should call setActiveSettingsSection when option clicked', async () => {
    const setActiveSettingsSection = vi.fn();
    mockChatTabs.setActiveSettingsSection = setActiveSettingsSection;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_domain')).toBeInTheDocument();
    });

    const domainButton = screen.getByText('builder_settings_nav_domain');
    await user.click(domainButton);

    await waitFor(() => {
      expect(setActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.DOMAIN);
    });
  });

  it('should close popover after option clicked', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_domain')).toBeInTheDocument();
    });

    const domainButton = screen.getByText('builder_settings_nav_domain');
    await user.click(domainButton);

    await waitFor(() => {
      expect(screen.queryByText('builder_settings_nav_domain')).not.toBeInTheDocument();
    });
  });

  it('should mark active section with active state', async () => {
    mockChatTabs.activeSettingsSection = SettingsSection.DATABASE;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_database')).toBeInTheDocument();
    });
  });

  it('should have correct data-eid on trigger button', () => {
    const { container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    expect(trigger).toHaveAttribute('data-eid', 'develop.chat_toolbar.settings');
  });

  it('should call openFeedbackModal when feedback clicked', async () => {
    const openFeedbackModal = vi.fn();
    mockDevelopStore.openFeedbackModal = openFeedbackModal;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
    });

    const feedbackButton = screen.getByText('builder_settings_nav_feedback');
    await user.click(feedbackButton);

    await waitFor(() => {
      expect(openFeedbackModal).toHaveBeenCalledWith('airo#app-builder', 'Settings');
    });
  });

  it('should close popover after feedback clicked', async () => {
    mockChatTabs.activeSettingsSection = SettingsSection.PROJECT;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
    });

    const feedbackButton = screen.getByText('builder_settings_nav_feedback');
    await user.click(feedbackButton);

    await waitFor(() => {
      expect(screen.queryByText('builder_settings_nav_feedback')).not.toBeInTheDocument();
    });
  });

  it('should trigger reauth when clicking needsAuth item', async () => {
    mockSwitchboardResults['appbuilder-settings-project'] = {
      data: undefined,
      error: new SwitchboardAuthError('appbuilder-settings-project'),
    };

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
    });

    const projectButton = screen.getByText('builder_settings_nav_project');
    await user.click(projectButton);

    await waitFor(() => {
      expect(mockSetNeedsReauth).toHaveBeenCalledWith('session_expired');
    });
  });

  it('should close popover when trigger button clicked a second time', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;

    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
    });

    await user.click(trigger);
    await waitFor(() => {
      expect(screen.queryByText('builder_settings_nav_project')).not.toBeInTheDocument();
    });
  });

  it('should close popover on Escape key', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('builder_settings_nav_project')).not.toBeInTheDocument();
    });
  });

  it('should close popover when clicking outside', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
    });

    await user.click(document.body);

    await waitFor(() => {
      expect(screen.queryByText('builder_settings_nav_project')).not.toBeInTheDocument();
    });
  });

  it('should close popover after clicking needsAuth item', async () => {
    mockSwitchboardResults['appbuilder-settings-domain'] = {
      data: undefined,
      error: new SwitchboardAuthError('appbuilder-settings-domain'),
    };

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-eid="develop.chat_toolbar.settings"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_domain')).toBeInTheDocument();
    });

    const domainButton = screen.getByText('builder_settings_nav_domain');
    await user.click(domainButton);

    await waitFor(() => {
      expect(screen.queryByText('builder_settings_nav_domain')).not.toBeInTheDocument();
    });
  });
});

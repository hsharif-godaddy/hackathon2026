/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { ChatTab, SettingsSection } from '@/app/[market]/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import { logClickEvent } from '@/utils/instrumentation';
import SettingsMenu from './SettingsMenu';

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'test-app-id',
}));

const mockDevelopStore = {
  openFeedbackModal: vi.fn(),
  isMobile: false,
  publishStates: {} as Record<string, { isSecurityAnalysisRunning?: boolean }>,
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

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(function () { return vi.fn(); }),
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

    expect(container.querySelector('[data-testid="chat-toolbar-settings-button"]')!).toBeInTheDocument();

  });

  it('should render settings trigger button', () => {
    const { container } = renderWithProviders(<SettingsMenu />);

    const button = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    expect(button).toBeInTheDocument();
  });

  it('should open popover when trigger button clicked', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
    });
  });

  it('should display all settings options when open', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
      expect(screen.queryByText('builder_settings_nav_domain')).not.toBeInTheDocument();
      expect(screen.getByText('builder_settings_nav_backups')).toBeInTheDocument();
      expect(screen.getByText('builder_settings_nav_security')).toBeInTheDocument();
      expect(screen.getByText('builder_settings_nav_database')).toBeInTheDocument();
      expect(screen.getByText('builder_settings_nav_secrets')).toBeInTheDocument();
    });
  });

  it('should display feedback option on desktop', async () => {
    mockChatTabs.activeSettingsSection = SettingsSection.PROJECT;
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
    });
  });

  it('should not display Display Ads when the switchboard flag is explicitly false', async () => {
    mockSwitchboardResults['appbuilder-settings-display-ads'] = false;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
    });
    expect(screen.queryByText('builder_settings_nav_display_ads')).not.toBeInTheDocument();
  });

  it('should navigate and log when Display Ads is clicked', async () => {
    mockSwitchboardResults['appbuilder-settings-display-ads'] = true;
    const setActiveSettingsSection = vi.fn();
    mockChatTabs.setActiveSettingsSection = setActiveSettingsSection;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_display_ads')).toBeInTheDocument();
    });

    await user.click(screen.getByText('builder_settings_nav_display_ads'));

    await waitFor(() => {
      expect(setActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.DISPLAY_ADS);
      expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith(
        'develop.settings_menu.displayAds',
        { appId: 'test-app-id' },
      );
    });
  });

  it('should call setActiveSettingsSection when option clicked', async () => {
    const setActiveSettingsSection = vi.fn();
    mockChatTabs.setActiveSettingsSection = setActiveSettingsSection;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_backups')).toBeInTheDocument();
    });

    const backupsButton = screen.getByText('builder_settings_nav_backups');
    await user.click(backupsButton);

    await waitFor(() => {
      expect(setActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.BACKUPS);
    });
  });

  it('should close popover after option clicked', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_backups')).toBeInTheDocument();
    });

    const backupsButton = screen.getByText('builder_settings_nav_backups');
    await user.click(backupsButton);

    await waitFor(() => {
      expect(screen.queryByText('builder_settings_nav_backups')).not.toBeInTheDocument();
    });
  });

  it('should mark active section with active state', async () => {
    mockChatTabs.activeSettingsSection = SettingsSection.DATABASE;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_database')).toBeInTheDocument();
    });
  });

  it('should expose settings menu trigger test id', () => {
    const { container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    expect(trigger).toHaveAttribute('aria-label', 'builder_chat_toolbar_button_settings');
  });

  it('should show history in settings menu on mobile', async () => {
    mockDevelopStore.isMobile = true;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('settings-menu-history-item')).toBeInTheDocument();
    });
  });

  it('should navigate to history from settings menu on mobile', async () => {
    mockDevelopStore.isMobile = true;
    const setActiveChatTab = vi.fn();
    mockChatTabs.setActiveChatTab = setActiveChatTab;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('settings-menu-history-item')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('settings-menu-history-item'));

    await waitFor(() => {
      expect(setActiveChatTab).toHaveBeenCalledWith(ChatTab.HISTORY);
    });
  });

  it('should show analytics in settings menu on mobile when flag enabled', async () => {
    mockDevelopStore.isMobile = true;
    mockSwitchboardResults['appbuilder-analytics'] = true;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('settings-menu-analytics-item')).toBeInTheDocument();
    });
  });

  it('should hide analytics in settings menu on mobile when flag disabled', async () => {
    mockDevelopStore.isMobile = true;
    mockSwitchboardResults['appbuilder-analytics'] = false;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('settings-menu-history-item')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('settings-menu-analytics-item')).not.toBeInTheDocument();
  });

  it('should mark analytics item as active when analytics tab selected on mobile', async () => {
    mockDevelopStore.isMobile = true;
    mockSwitchboardResults['appbuilder-analytics'] = true;
    mockChatTabs.activeChatTab = ChatTab.ANALYTICS;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('settings-menu-analytics-item')).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByTestId('settings-menu-history-item')).toHaveAttribute('aria-selected', 'false');
  });

  it('should navigate to analytics from settings menu on mobile', async () => {
    mockDevelopStore.isMobile = true;
    mockSwitchboardResults['appbuilder-analytics'] = true;
    const setActiveChatTab = vi.fn();
    mockChatTabs.setActiveChatTab = setActiveChatTab;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('settings-menu-analytics-item')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('settings-menu-analytics-item'));

    await waitFor(() => {
      expect(setActiveChatTab).toHaveBeenCalledWith(ChatTab.ANALYTICS);
      expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith(
        'develop.settings_menu.analytics',
        { appId: 'test-app-id' },
      );
    });
  });

  it('should log click when settings nav item clicked', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_backups')).toBeInTheDocument();
    });

    await user.click(screen.getByText('builder_settings_nav_backups'));

    await waitFor(() => {
      expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith(
        'develop.settings_menu.backups',
        { appId: 'test-app-id' },
      );
    });
  });

  it('should call openFeedbackModal when feedback clicked', async () => {
    const openFeedbackModal = vi.fn();
    mockDevelopStore.openFeedbackModal = openFeedbackModal;

    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
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

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
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

  it('should close popover when trigger button clicked a second time', async () => {
    const { user, container } = renderWithProviders(<SettingsMenu />);

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;

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

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
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

    const trigger = container.querySelector('[data-testid="chat-toolbar-settings-button"]')!;
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
    });

    await user.click(document.body);

    await waitFor(() => {
      expect(screen.queryByText('builder_settings_nav_project')).not.toBeInTheDocument();
    });
  });

});

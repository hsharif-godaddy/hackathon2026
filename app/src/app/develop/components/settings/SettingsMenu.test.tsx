import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { ChatTab, SettingsSection } from '@/app/develop/components/types';
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

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => {
    if (feature === 'appbuilder-settings-project') return { data: true };
    if (feature === 'appbuilder-settings-domain') return { data: true };
    if (feature === 'appbuilder-settings-backups') return { data: true };
    if (feature === 'appbuilder-settings-security') return { data: true };
    if (feature === 'appbuilder-settings-secrets') return { data: true };
    if (feature === 'appbuilder-settings-visualscan') return { data: false };
    return { data: false };
  },
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

describe('SettingsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatTabs.activeSettingsSection = SettingsSection.PROJECT;
    mockDevelopStore.isMobile = false;
    mockDevelopStore.openFeedbackModal.mockReset();
  });

  it('should render without crashing', () => {
    renderWithProviders(<SettingsMenu />);

    expect(screen.getByLabelText('builder_settings_title')).toBeInTheDocument();
  });

  it('should render settings trigger button', () => {
    renderWithProviders(<SettingsMenu />);

    const button = screen.getByLabelText('builder_settings_title');
    expect(button).toBeInTheDocument();
  });

  it('should open popover when trigger button clicked', async () => {
    const { user } = renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_project')).toBeInTheDocument();
    });
  });

  it('should display all settings options when open', async () => {
    const { user } = renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
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
    const { user } = renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
    });
  });

  it('should call setActiveSettingsSection when option clicked', async () => {
    const setActiveSettingsSection = vi.fn();
    mockChatTabs.setActiveSettingsSection = setActiveSettingsSection;

    const { user } = renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
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
    const { user } = renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
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

    const { user } = renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_database')).toBeInTheDocument();
    });
  });

  it('should have correct data-eid on trigger button', () => {
    renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
    expect(trigger).toHaveAttribute('data-eid', 'develop.chat_toolbar.settings');
  });

  it('should call openFeedbackModal when feedback clicked', async () => {
    const openFeedbackModal = vi.fn();
    mockDevelopStore.openFeedbackModal = openFeedbackModal;

    const { user } = renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
    });

    const feedbackButton = screen.getByText('builder_settings_nav_feedback');
    await user.click(feedbackButton);

    await waitFor(() => {
      expect(openFeedbackModal).toHaveBeenCalledWith('airo#app-builder');
    });
  });

  it('should close popover after feedback clicked', async () => {
    mockChatTabs.activeSettingsSection = SettingsSection.PROJECT;

    const { user } = renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
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
});

import '@testing-library/jest-dom';

import { beforeEach,describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { SettingsSection } from '@/app/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import SettingsMenu from './SettingsMenu';

const mockRouter = { push: vi.fn() };
const mockDevelopStore = {
  activeSettingsSection: SettingsSection.PROJECT,
  setActiveSettingsSection: vi.fn(),
  openFeedbackModal: vi.fn(),
  isMobile: false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('@/app/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}));

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

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

describe('SettingsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.activeSettingsSection = SettingsSection.PROJECT;
    mockDevelopStore.isMobile = false;
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
    mockDevelopStore.isMobile = false;
    const { user } = renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
    });
  });

  it('should call setActiveSettingsSection when option clicked', async () => {
    const setActiveSettingsSection = vi.fn();
    mockDevelopStore.setActiveSettingsSection = setActiveSettingsSection;

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

  it('should navigate when option clicked', async () => {
    const push = vi.fn();
    mockRouter.push = push;

    const { user } = renderWithProviders(<SettingsMenu />);

    const trigger = screen.getByLabelText('builder_settings_title');
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_domain')).toBeInTheDocument();
    });

    const domainButton = screen.getByText('builder_settings_nav_domain');
    await user.click(domainButton);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/develop/app-123?tab=settings&settings=domain', { scroll: false });
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
    mockDevelopStore.activeSettingsSection = SettingsSection.DATABASE;

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
    mockDevelopStore.isMobile = false;

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
    mockDevelopStore.isMobile = false;

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

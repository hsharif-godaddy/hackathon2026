/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { ChatTab, MobileMode, SettingsSection, ViewMode } from '@/app/[market]/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import DomainMenu from './DomainMenu';

const mockHandleViewModeChange = vi.fn();
const mockHandleMobileModeChange = vi.fn();
const mockSetActiveChatTab = vi.fn();
const mockSetActiveSettingsSection = vi.fn();

const mockDevelopPageStore = {
  site: {
    preview_url: 'https://preview.test/app',
    published_url: 'https://test.airoapp.ai',
  },
  isMobile: false,
  hasUnsavedChanges: false,
  handleViewModeChange: mockHandleViewModeChange,
  handleMobileModeChange: mockHandleMobileModeChange,
};

const mockSwitchboardOverrides: Record<string, boolean> = {};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: typeof mockDevelopPageStore) => unknown) =>
    selector(mockDevelopPageStore),
}));

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    setActiveChatTab: mockSetActiveChatTab,
    setActiveSettingsSection: mockSetActiveSettingsSection,
  }),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => mockSwitchboardOverrides[feature] ?? false,
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'test-app-123',
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(() => true),
}));

describe('DomainMenu', function domainMenuTests() {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopPageStore.isMobile = false;
    mockDevelopPageStore.hasUnsavedChanges = false;
    for (const key of Object.keys(mockSwitchboardOverrides)) {
      delete mockSwitchboardOverrides[key];
    }
  });

  describe('#handleDomainSettings', function handleDomainSettingsTests() {
    it('should call handleViewModeChange with DOMAIN on desktop when top-level flag is on', async function desktopViewMode() {
      mockSwitchboardOverrides['appbuilder-domain-top-level'] = true;

      const { user } = renderWithProviders(<DomainMenu />);

      await user.click(screen.getByRole('button', { name: 'builder_domain_button_visit' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'builder_domain_title' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'builder_domain_title' }));

      expect(mockHandleViewModeChange).toHaveBeenCalledWith(ViewMode.DOMAIN, false);
      expect(mockHandleMobileModeChange).not.toHaveBeenCalled();
      expect(mockSetActiveSettingsSection).not.toHaveBeenCalled();
      expect(mockSetActiveChatTab).not.toHaveBeenCalled();
    });

    it('should call handleMobileModeChange with PREVIEW on mobile when top-level flag is on', async function mobilePreviewMode() {
      mockSwitchboardOverrides['appbuilder-domain-top-level'] = true;
      mockDevelopPageStore.isMobile = true;

      const { user } = renderWithProviders(<DomainMenu />);

      await user.click(screen.getByRole('button', { name: 'builder_domain_button_visit' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'builder_domain_title' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'builder_domain_title' }));

      expect(mockHandleViewModeChange).toHaveBeenCalledWith(ViewMode.DOMAIN, false);
      expect(mockHandleMobileModeChange).toHaveBeenCalledWith(MobileMode.PREVIEW);
    });

    it('should navigate to settings DOMAIN section when top-level flag is off', async function settingsFlagOff() {
      mockSwitchboardOverrides['appbuilder-domain-top-level'] = false;

      const { user } = renderWithProviders(<DomainMenu />);

      await user.click(screen.getByRole('button', { name: 'builder_domain_button_visit' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'builder_domain_title' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'builder_domain_title' }));

      expect(mockSetActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.DOMAIN);
      expect(mockSetActiveChatTab).toHaveBeenCalledWith(ChatTab.SETTINGS);
      expect(mockHandleViewModeChange).not.toHaveBeenCalled();
      expect(mockHandleMobileModeChange).not.toHaveBeenCalled();
    });
  });
});

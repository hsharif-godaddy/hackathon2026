import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import PreviewHeader from './PreviewHeader';
import { PreviewViewMode,ViewMode } from '../types';

const mockDevelopStore = {
  viewMode: ViewMode.PREVIEW,
  isCheckingApp: false,
  isStartingApp: false,
  isRestarting: false,
  previewViewMode: PreviewViewMode.DESKTOP,
  selectedDeviceId: 'full',
  hasUnsavedChanges: false,
  isSelectMode: false,
  isChatPaneCollapsed: false,
  isVersionHistoryOpen: false,
  site: { name: 'Test App' },
  handleViewModeChange: vi.fn(),
  setPreviewViewMode: vi.fn(),
  setSelectedDeviceId: vi.fn(),
  toggleSelectMode: vi.fn(),
  toggleChatPaneCollapse: vi.fn(),
  openFeedbackModal: vi.fn(),
};
const mockServerState = {
  port: 3000,
  url: 'http://localhost:3000',
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/app/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));
vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: any) => {
    const state = {
      getServerState: () => mockServerState,
    };
    return selector(state);
  },
}));
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => ({ data: true }),
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
  logAiroHQEvent: vi.fn(() => vi.fn()),
}));

describe('PreviewHeader', () => {
  const defaultProps = {
    onPreviewRefresh: vi.fn(),
    isMobile: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.viewMode = ViewMode.PREVIEW;
    mockDevelopStore.previewViewMode = PreviewViewMode.DESKTOP;
    mockDevelopStore.isChatPaneCollapsed = false;
    mockDevelopStore.isSelectMode = false;
  });

  it('should render without crashing', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('builder_preview_button_preview')).toBeInTheDocument();
  });

  it('should render preview button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('builder_preview_button_preview')).toBeInTheDocument();
  });

  it('should render code editor button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('builder_preview_button_code')).toBeInTheDocument();
  });

  it('should render refresh button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('builder_preview_button_refresh')).toBeInTheDocument();
  });

  it('should render collapse/expand chat pane button on desktop', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={false} />);

    expect(screen.getByLabelText('builder_preview_button_collapse')).toBeInTheDocument();
  });

  it('should not render collapse/expand button on mobile', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={true} />);

    expect(screen.queryByLabelText('builder_preview_button_collapse')).not.toBeInTheDocument();
  });

  it('should render select mode button on desktop', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={false} />);

    expect(screen.getByLabelText('builder_preview_button_select')).toBeInTheDocument();
  });

  it('should not render builder_preview_button_select button on mobile', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={true} />);

    expect(screen.queryByLabelText('Select Mode')).not.toBeInTheDocument();
  });

  it('should render device selector on desktop', () => {
    const { container } = renderWithProviders(<PreviewHeader {...defaultProps} isMobile={false} />);

    // DeviceSelector shows "Full size" by default (uses defaultMessage fallback)
    const button = container.querySelector('[data-eid="develop.preview.device_selector"]');
    expect(button).toBeInTheDocument();
  });

  it('should not render device selector on mobile', () => {
    const { container } = renderWithProviders(<PreviewHeader {...defaultProps} isMobile={true} />);

    const button = container.querySelector('[data-eid="develop.preview.device_selector"]');
    expect(button).not.toBeInTheDocument();
  });

  it('should render open in new tab button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('builder_common_open_new_tab')).toBeInTheDocument();
  });

  it('should display site name in domain button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByText('Test App')).toBeInTheDocument();
  });

  it('should disable refresh button when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const refreshButton = screen.getByLabelText('builder_preview_button_refresh');
    expect(refreshButton).toBeDisabled();
  });

  it('should disable select mode button when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const selectButton = screen.getByLabelText('builder_preview_button_select');
    expect(selectButton).toBeDisabled();
  });

  it('should disable device selector when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    const { container } = renderWithProviders(<PreviewHeader {...defaultProps} />);

    // DeviceSelector button should be disabled
    const deviceSelectorButton = container.querySelector('[data-eid="develop.preview.device_selector"]');
    expect(deviceSelectorButton).toBeInTheDocument();
    expect(deviceSelectorButton).toBeDisabled();
  });

  it('should disable open in new tab when app is starting', () => {
    mockDevelopStore.isStartingApp = true;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const newTabButton = screen.getByLabelText('builder_common_open_new_tab');
    expect(newTabButton).toBeDisabled();
  });

  it('should disable open in new tab when app is restarting', () => {
    mockDevelopStore.isRestarting = true;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const newTabButton = screen.getByLabelText('builder_common_open_new_tab');
    expect(newTabButton).toBeDisabled();
  });

  it('should have correct button count on desktop', () => {
    const { container } = renderWithProviders(<PreviewHeader {...defaultProps} />);

    const buttons = container.querySelectorAll('button');
    // Collapse, Preview, Code, Select, Refresh, DeviceSelector, New Tab = 7 buttons
    expect(buttons.length).toBe(7);
  });

  it('should disable code button when version history is open', () => {
    mockDevelopStore.isVersionHistoryOpen = true;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const codeButton = screen.getByLabelText('builder_preview_button_code');
    expect(codeButton).toBeDisabled();
  });

  it('should disable select mode button when version history is open', () => {
    mockDevelopStore.isVersionHistoryOpen = true;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const selectButton = screen.getByLabelText('builder_preview_button_select');
    expect(selectButton).toBeDisabled();
  });
});

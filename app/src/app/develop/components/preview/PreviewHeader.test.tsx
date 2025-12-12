import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import PreviewHeader from './PreviewHeader';
import { ViewMode, PreviewViewMode } from '../types';

const mockRouter = { push: vi.fn() };
const mockDevelopStore = {
  viewMode: ViewMode.PREVIEW,
  isCheckingApp: false,
  isStartingApp: false,
  isRestarting: false,
  previewViewMode: PreviewViewMode.DESKTOP,
  hasUnsavedChanges: false,
  isSelectMode: false,
  isChatPaneCollapsed: false,
  site: { name: 'Test App' },
  handleViewModeChange: vi.fn(),
  setPreviewViewMode: vi.fn(),
  toggleSelectMode: vi.fn(),
  toggleChatPaneCollapse: vi.fn(),
  openFeedbackModal: vi.fn(),
  setActiveChatTab: vi.fn(),
  setActiveSettingsSection: vi.fn(),
};
const mockServerState = {
  port: 3000,
  url: 'http://localhost:3000',
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

    expect(screen.getByLabelText('Preview')).toBeInTheDocument();
  });

  it('should render preview button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('Preview')).toBeInTheDocument();
  });

  it('should render code editor button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('Code Editor')).toBeInTheDocument();
  });

  it('should render refresh button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('Refresh Preview')).toBeInTheDocument();
  });

  it('should render collapse/expand chat pane button on desktop', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={false} />);

    expect(screen.getByLabelText('Collapse Chat Pane')).toBeInTheDocument();
  });

  it('should not render collapse/expand button on mobile', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={true} />);

    expect(screen.queryByLabelText('Collapse Chat Pane')).not.toBeInTheDocument();
  });

  it('should render select mode button on desktop', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={false} />);

    expect(screen.getByLabelText('Select Mode')).toBeInTheDocument();
  });

  it('should not render select mode button on mobile', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={true} />);

    expect(screen.queryByLabelText('Select Mode')).not.toBeInTheDocument();
  });

  it('should render desktop preview button on desktop', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={false} />);

    expect(screen.getByLabelText('Preview Desktop')).toBeInTheDocument();
  });

  it('should render mobile preview button on desktop', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={false} />);

    expect(screen.getByLabelText('Preview Mobile')).toBeInTheDocument();
  });

  it('should not render preview size buttons on mobile', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={true} />);

    expect(screen.queryByLabelText('Preview Desktop')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preview Mobile')).not.toBeInTheDocument();
  });

  it('should render open in new tab button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('Open in new tab')).toBeInTheDocument();
  });

  it('should display site name in domain button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByText('Test App')).toBeInTheDocument();
  });

  it('should disable refresh button when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const refreshButton = screen.getByLabelText('Refresh Preview');
    expect(refreshButton).toBeDisabled();
  });

  it('should disable select mode button when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const selectButton = screen.getByLabelText('Select Mode');
    expect(selectButton).toBeDisabled();
  });

  it('should disable preview size buttons when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const desktopButton = screen.getByLabelText('Preview Desktop');
    const mobileButton = screen.getByLabelText('Preview Mobile');

    expect(desktopButton).toBeDisabled();
    expect(mobileButton).toBeDisabled();
  });

  it('should disable open in new tab when app is starting', () => {
    mockDevelopStore.isStartingApp = true;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const newTabButton = screen.getByLabelText('Open in new tab');
    expect(newTabButton).toBeDisabled();
  });

  it('should disable open in new tab when app is restarting', () => {
    mockDevelopStore.isRestarting = true;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const newTabButton = screen.getByLabelText('Open in new tab');
    expect(newTabButton).toBeDisabled();
  });

  it('should have correct button count on desktop', () => {
    const { container } = renderWithProviders(<PreviewHeader {...defaultProps} />);

    const buttons = container.querySelectorAll('button');
    // Collapse, Preview, Code, Select, Refresh, Desktop, Mobile, New Tab = 8 buttons
    expect(buttons.length).toBe(8);
  });
});

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

let mockMultiUser: boolean | undefined = true;
const mockSetActiveSettingsSection = vi.fn();
const mockStoreState: Record<string, unknown> = {
  chatPaneWidth: 320,
  isChatPaneCollapsed: false,
  isMobile: false,
  currentAppId: 'app-1',
  activeSettingsSection: 'project',
  setActiveSettingsSection: mockSetActiveSettingsSection,
};

const mockReconcile = vi.fn();

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockMultiUser,
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (_id: string, _values?: unknown, defaultMessage?: string) =>
    defaultMessage ?? _id,
}));

vi.mock('@/lib/mgmt-airo/trigger-collaborator-reconcile', () => ({
  triggerCollaboratorReconcile: (...args: unknown[]) => mockReconcile(...args),
  startReconcilePolling: vi.fn(),
  stopReconcilePolling: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockStoreState),
}));

vi.mock('@/app/[market]/develop/components/settings/TeamPanel', () => ({
  default: () => <div data-testid="team-panel-stub" />,
}));

vi.mock('@/app/[market]/develop/components/IconButton', () => ({
  default: ({ label, onClick, 'data-testid': testId }: any) => (
    <button type="button" data-testid={testId} onClick={onClick}>
      {label}
    </button>
  ),
}));

import ShareAccess, { ShareAccessButton } from './ShareAccess';

function renderWithButton() {
  return render(
    <>
      <ShareAccessButton />
      <ShareAccess />
    </>
  );
}

describe('ShareAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMultiUser = true;
    mockStoreState.currentAppId = 'app-1';
    mockStoreState.activeSettingsSection = 'project';
  });

  describe('flag gating', () => {
    it('renders nothing when aab-multi-user is false', () => {
      mockMultiUser = false;
      const { container } = render(<ShareAccess />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when aab-multi-user is undefined', () => {
      mockMultiUser = undefined;
      const { container } = render(<ShareAccess />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders the toolbar button when aab-multi-user is true', () => {
      renderWithButton();
      expect(screen.getByTestId('share-access-button')).toBeInTheDocument();
    });
  });

  describe('canvas behavior', () => {
    it('opens the canvas when activeSettingsSection is TEAM', () => {
      mockStoreState.activeSettingsSection = 'team';
      renderWithButton();

      expect(screen.getByTestId('share-access-fullpage')).toBeInTheDocument();
      expect(mockReconcile).toHaveBeenCalledWith('app-1');
    });

    it('does NOT have a close button', () => {
      mockStoreState.activeSettingsSection = 'team';
      renderWithButton();

      expect(screen.queryByTestId('share-access-close')).not.toBeInTheDocument();
    });

    it('does NOT close on Escape', () => {
      mockStoreState.activeSettingsSection = 'team';
      renderWithButton();
      expect(screen.getByTestId('share-access-fullpage')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.getByTestId('share-access-fullpage')).toBeInTheDocument();
    });

    it('dismisses on pointerdown outside the team UI (navigation away)', () => {
      mockStoreState.activeSettingsSection = 'team';
      renderWithButton();
      expect(screen.getByTestId('share-access-fullpage')).toBeInTheDocument();

      const outside = document.createElement('div');
      document.body.appendChild(outside);
      fireEvent.pointerDown(outside);

      expect(screen.queryByTestId('share-access-fullpage')).not.toBeInTheDocument();
      document.body.removeChild(outside);
    });

    it('does NOT dismiss on pointerdown inside the team UI', () => {
      mockStoreState.activeSettingsSection = 'team';
      renderWithButton();

      fireEvent.pointerDown(screen.getByTestId('share-access-fullpage'));
      expect(screen.getByTestId('share-access-fullpage')).toBeInTheDocument();
    });
  });

  describe('reconcile lifecycle', () => {
    it('fires reconcile on open and on close', () => {
      mockStoreState.activeSettingsSection = 'team';
      const { unmount } = render(<ShareAccess />);
      expect(mockReconcile).toHaveBeenCalledTimes(1);

      unmount();
      expect(mockReconcile).toHaveBeenCalledTimes(2);
    });

    it('does not reconcile when there is no current app id', () => {
      mockStoreState.currentAppId = undefined;
      mockStoreState.activeSettingsSection = 'team';
      render(<ShareAccess />);
      expect(mockReconcile).not.toHaveBeenCalled();
    });
  });

  describe('ShareAccessButton', () => {
    it('calls setActiveSettingsSection(TEAM) on click', () => {
      renderWithButton();
      fireEvent.click(screen.getByTestId('share-access-button'));
      expect(mockSetActiveSettingsSection).toHaveBeenCalledWith('team');
    });
  });
});

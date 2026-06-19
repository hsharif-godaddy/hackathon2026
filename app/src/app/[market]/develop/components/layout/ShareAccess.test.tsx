/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Controllable switchboard value + develop-store state.
let mockMultiUser: boolean | undefined = true;
const mockStoreState: Record<string, unknown> = {
  chatPaneWidth: 320,
  isChatPaneCollapsed: false,
  currentAppId: 'app-1',
  activeSettingsSection: 'project',
};

const mockReconcile = vi.fn();

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockMultiUser,
}));

vi.mock('@/hooks/useTranslations', () => ({
  // Echo the defaultMessage so labels are assertable.
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

// Avoid loading the heavy CDS multiusersEsm bundle.
vi.mock('@/app/[market]/develop/components/settings/TeamPanel', () => ({
  default: () => <div data-testid="team-panel-stub" />,
}));

// IconButton pulls UXCore — stub to a plain button that forwards the props we assert.
vi.mock('@/app/[market]/develop/components/IconButton', () => ({
  default: ({ label, onClick, 'data-testid': testId, 'aria-expanded': expanded }: any) => (
    <button type="button" data-testid={testId} aria-expanded={expanded} onClick={onClick}>
      {label}
    </button>
  ),
}));

import ShareAccess from './ShareAccess';

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
      expect(screen.queryByTestId('share-access-button')).not.toBeInTheDocument();
    });

    it('renders nothing when aab-multi-user is undefined (SSR / flag absent)', () => {
      mockMultiUser = undefined;
      const { container } = render(<ShareAccess />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders the toolbar button when aab-multi-user is true', () => {
      render(<ShareAccess />);
      expect(screen.getByTestId('share-access-button')).toBeInTheDocument();
    });
  });

  describe('open / close', () => {
    it('opens the overlay on button click and fires reconcile on open', () => {
      render(<ShareAccess />);
      expect(screen.queryByTestId('share-access-fullpage')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('share-access-button'));

      expect(screen.getByTestId('share-access-fullpage')).toBeInTheDocument();
      expect(screen.getByTestId('share-access-close')).toBeInTheDocument();
      // Reconcile-on-open with the current app id.
      expect(mockReconcile).toHaveBeenCalledWith('app-1');
    });

    it('closes when the close button is clicked', () => {
      render(<ShareAccess />);
      fireEvent.click(screen.getByTestId('share-access-button'));
      expect(screen.getByTestId('share-access-fullpage')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('share-access-close'));
      expect(screen.queryByTestId('share-access-fullpage')).not.toBeInTheDocument();
    });

    it('closes on Escape', () => {
      render(<ShareAccess />);
      fireEvent.click(screen.getByTestId('share-access-button'));
      expect(screen.getByTestId('share-access-fullpage')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByTestId('share-access-fullpage')).not.toBeInTheDocument();
    });

    it('dismisses on a pointerdown outside the team UI', () => {
      render(<ShareAccess />);
      fireEvent.click(screen.getByTestId('share-access-button'));
      expect(screen.getByTestId('share-access-fullpage')).toBeInTheDocument();

      // An element that matches none of the KEEP_OPEN selectors → dismiss.
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      fireEvent.pointerDown(outside);

      expect(screen.queryByTestId('share-access-fullpage')).not.toBeInTheDocument();
      document.body.removeChild(outside);
    });

    it('does NOT dismiss on a pointerdown inside the overlay (close button)', () => {
      render(<ShareAccess />);
      fireEvent.click(screen.getByTestId('share-access-button'));

      // Pointerdown on the close button is "inside" — overlay stays open
      // (the click handler, not the outside-dismiss, governs closing).
      fireEvent.pointerDown(screen.getByTestId('share-access-close'));
      expect(screen.getByTestId('share-access-fullpage')).toBeInTheDocument();
    });
  });

  describe('reconcile lifecycle', () => {
    it('fires reconcile again on close (open effect cleanup)', () => {
      render(<ShareAccess />);
      fireEvent.click(screen.getByTestId('share-access-button'));
      expect(mockReconcile).toHaveBeenCalledTimes(1); // open

      fireEvent.click(screen.getByTestId('share-access-close'));
      // cleanup of the open effect reconciles once more (catches the just-made invite)
      expect(mockReconcile).toHaveBeenCalledTimes(2);
    });

    it('does not reconcile when there is no current app id', () => {
      mockStoreState.currentAppId = undefined;
      render(<ShareAccess />);
      fireEvent.click(screen.getByTestId('share-access-button'));
      expect(mockReconcile).not.toHaveBeenCalled();
    });
  });
});

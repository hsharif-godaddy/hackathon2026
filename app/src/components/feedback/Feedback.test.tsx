import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@ux/modal', () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@ux/spinner', () => ({
  default: () => <div data-testid="spinner" />,
}));

vi.mock('@ux/text', () => ({
  default: {
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
  },
}));

vi.mock('@ux/button', () => ({
  default: ({ text, onClick, type }: any) => (
    <button type={type || 'button'} onClick={onClick}>{text}</button>
  ),
}));

vi.mock('@ux/checkbox', () => ({
  default: ({ label, ...props }: any) => <input type="checkbox" aria-label={label} {...props} />,
}));

vi.mock('@ux/radio', () => ({
  default: ({ label, id }: any) => <input type="radio" aria-label={label} id={id} />,
}));

vi.mock('@ux/text-input', () => ({
  default: ({ label, ...props }: any) => <input aria-label={label} {...props} />,
}));

vi.mock('@ux/box', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn(() => null),
}));

vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/components/feedback/utils', () => ({
  isLocalhost: vi.fn(() => true),
  getMockFeedbackConfig: vi.fn(() => ({
    pk: 'airo#app-builder',
    fields: [],
  })),
  getBaseUrl: vi.fn(() => 'https://example.com/'),
  getFullStorySessionUrl: vi.fn(() => Promise.resolve(null)),
}));

import { Feedback } from './Feedback';

const defaultProps = {
  feedbackId: 'airo#app-builder',
  onClose: vi.fn(),
};

function mockAuth(authType: string | undefined) {
  vi.mocked(useAuthContext).mockReturnValue({
    authState: authType ? ({ authType } as any) : null,
    isAuthenticated: true,
    isLoading: false,
    needsReauth: false,
    config: null,
    gasketConfig: null,
    configLoading: false,
    configError: null,
    getUserEmail: vi.fn(),
    getUserInfo: vi.fn(),
    handleSignIn: vi.fn(),
    handleSignOut: vi.fn(),
    isAuthDisabled: false,
    authType: 'jwt',
    isMockAuth: false,
    mockAuth: null,
  });
}

describe('Feedback', function feedbackTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ success: true }),
    } as Response));
  });

  describe('normal customer session (basic auth)', function normalSessionTests() {
    it('should render the modal', async function renderModal() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('should show FeedbackDescription', async function showDescription() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /contact/i })).toBeInTheDocument();
      });
    });
  });

  describe('CRM impersonation session (e2s auth)', function e2sTests() {
    it('should render the modal', async function renderModal() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('should not show FeedbackDescription link', async function hideDescription() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.queryByRole('link', { name: /contact/i })).toBeNull();
    });

    it('should not render the submit button', async function hideSubmit() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: 'builder_common_submit' })).toBeNull();
    });

    it('should not fetch feedback config', async function skipFetch() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('e2s2s impersonation session', function e2s2sTests() {
    it('should not render the submit button', async function hideSubmit() {
      mockAuth('e2s2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: 'builder_common_submit' })).toBeNull();
    });

    it('should not fetch feedback config', async function skipFetch() {
      mockAuth('e2s2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

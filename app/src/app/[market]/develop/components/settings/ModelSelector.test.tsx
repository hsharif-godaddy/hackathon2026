/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import ModelSelector from './ModelSelector';

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-123'),
}));

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: vi.fn(async () => 'https://agent.test/api/models'),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(async () => new Response(
    JSON.stringify({
      models: [
        { shortName: 'claude-opus-4-6', fullName: 'Claude Opus 4.6', provider: 'anthropic', isSupported: true },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: false, isLoading: false, error: null })),
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(() => ({ authState: { authType: 'basic' } })),
}));

vi.mock('@/stores/useDevelopPageStore', () => {
  const state = { selectedModel: null, setSelectedModel: vi.fn() };
  const useDevelopPageStore = (selector: (s: typeof state) => unknown) => selector(state);
  return { useDevelopPageStore };
});

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('non-impersonation session', () => {
    it('should render nothing when switchboard flag is false', async function disabledFlag() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue({
        data: false, isLoading: false, error: null,
      } as ReturnType<typeof useSwitchboard>);

      const { container } = renderWithProviders(<ModelSelector />);

      expect(container).toBeEmptyDOMElement();
    });

    it('should render nothing while switchboard flag is loading', async function loadingFlag() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue({
        data: undefined, isLoading: true, error: null,
      } as ReturnType<typeof useSwitchboard>);

      const { container } = renderWithProviders(<ModelSelector />);

      expect(container).toBeEmptyDOMElement();
    });

    it('should render the dropdown when switchboard flag is true', async function enabledFlag() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue({
        data: true, isLoading: false, error: null,
      } as ReturnType<typeof useSwitchboard>);

      renderWithProviders(<ModelSelector />);

      await waitFor(() => {
        expect(screen.getByTestId('model-selector')).toBeInTheDocument();
      });
    });
  });

  describe('CRM skip / impersonation session', () => {
    it('should render the dropdown for e2s sessions even when switchboard flag is false', async function e2sBypass() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useAuthContext).mockReturnValue({
        authState: { authType: 'e2s' },
      } as ReturnType<typeof useAuthContext>);
      vi.mocked(useSwitchboard).mockReturnValue({
        data: false, isLoading: false, error: null,
      } as ReturnType<typeof useSwitchboard>);

      renderWithProviders(<ModelSelector />);

      await waitFor(() => {
        expect(screen.getByTestId('model-selector')).toBeInTheDocument();
      });
    });

    it('should render the dropdown for e2s2s sessions even when switchboard flag is false', async function e2s2sBypass() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useAuthContext).mockReturnValue({
        authState: { authType: 'e2s2s' },
      } as ReturnType<typeof useAuthContext>);
      vi.mocked(useSwitchboard).mockReturnValue({
        data: false, isLoading: false, error: null,
      } as ReturnType<typeof useSwitchboard>);

      renderWithProviders(<ModelSelector />);

      await waitFor(() => {
        expect(screen.getByTestId('model-selector')).toBeInTheDocument();
      });
    });

    it('should not wait on switchboard loading state for impersonation sessions', async function bypassLoading() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useAuthContext).mockReturnValue({
        authState: { authType: 'e2s' },
      } as ReturnType<typeof useAuthContext>);
      vi.mocked(useSwitchboard).mockReturnValue({
        data: undefined, isLoading: true, error: null,
      } as ReturnType<typeof useSwitchboard>);

      renderWithProviders(<ModelSelector />);

      await waitFor(() => {
        expect(screen.getByTestId('model-selector')).toBeInTheDocument();
      });
    });

    it('should skip the switchboard network call for impersonation sessions', async function bypassQuery() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useAuthContext).mockReturnValue({
        authState: { authType: 'e2s' },
      } as ReturnType<typeof useAuthContext>);

      renderWithProviders(<ModelSelector />);

      await waitFor(() => {
        expect(useSwitchboard).toHaveBeenCalledWith('appbuilder-model-selector', { enabled: false });
      });
    });

    it('should include the Opus model option when loaded', async function opusOption() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      vi.mocked(useAuthContext).mockReturnValue({
        authState: { authType: 'e2s' },
      } as ReturnType<typeof useAuthContext>);

      renderWithProviders(<ModelSelector />);

      await waitFor(() => {
        const option = screen.getByRole('option', { name: /Claude Opus 4\.6/i });
        expect(option).toBeInTheDocument();
      });
    });
  });
});

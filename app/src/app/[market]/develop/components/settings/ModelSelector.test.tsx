/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import ModelSelector from './ModelSelector';

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(function () { return 'test-app-123'; }),
}));

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: vi.fn(async function () { return 'https://agent.test/api/models'; }),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(async function () { return new Response(
    JSON.stringify({
      models: [
        { shortName: 'claude-opus-4-6', fullName: 'Claude Opus 4.6', provider: 'anthropic', isSupported: true },
        { shortName: 'azure/Kimi-K2.6', fullName: 'azure/Kimi-K2.6', provider: 'openai', isSupported: true },
        { shortName: 'azure/Kimi-K2.6-thinking', fullName: 'azure/Kimi-K2.6', provider: 'openai', isSupported: true },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  ); }),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return false; }),
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(function () { return { authState: { authType: 'basic' } }; }),
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
      vi.mocked(useSwitchboard).mockReturnValue(false);

      const { container } = renderWithProviders(<ModelSelector />);

      expect(container).toBeEmptyDOMElement();
    });

    it('should render the dropdown when switchboard flag is true', async function enabledFlag() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);

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
      vi.mocked(useSwitchboard).mockReturnValue(false);

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
      vi.mocked(useSwitchboard).mockReturnValue(false);

      renderWithProviders(<ModelSelector />);

      await waitFor(() => {
        expect(screen.getByTestId('model-selector')).toBeInTheDocument();
      });
    });

    it('labels options by shortName so same-fullName variants stay distinct', async function shortNameLabels() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      vi.mocked(useAuthContext).mockReturnValue({
        authState: { authType: 'e2s' },
      } as ReturnType<typeof useAuthContext>);

      renderWithProviders(<ModelSelector />);

      await waitFor(() => {
        expect(screen.getByRole('option', { name: /claude-opus-4-6/i })).toBeInTheDocument();
      });

      // The two Kimi variants share a fullName (azure/Kimi-K2.6); labeling by
      // shortName is what keeps them distinguishable in the dropdown.
      expect(screen.getByRole('option', { name: /^azure\/Kimi-K2\.6 \(/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /azure\/Kimi-K2\.6-thinking/i })).toBeInTheDocument();
    });
  });
});

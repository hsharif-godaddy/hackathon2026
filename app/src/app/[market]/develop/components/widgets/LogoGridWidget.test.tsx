/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import LogoGridWidget, { getLogoDisplayUrl, type LogoData } from './LogoGridWidget';

const { streamingMocks, mockSendUserMessage } = vi.hoisted(() => ({
  streamingMocks: { isStreaming: false, isLoading: false },
  mockSendUserMessage: vi.fn(),
}));

vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: vi.fn(() => mockSendUserMessage),
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'app-123'),
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'https://agent.example.com' }),
  },
}));

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => streamingMocks.isStreaming,
  useIsLoading: () => streamingMocks.isLoading,
}));

vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, ...props }: ComponentProps<'button'>) => (
      <button type="button" {...props}>{children}</button>
    ),
  },
}));

function baseLogos(overrides: Partial<LogoData> = {}): LogoData[] {
  return [
    {
      id: '1',
      transparentUrl: 'https://cdn.example.com/t1.png',
      solidUrl: 'https://cdn.example.com/s1.png',
      ...overrides,
    },
    {
      id: '2',
      transparentUrl: 'https://cdn.example.com/t2.png',
      solidUrl: 'https://cdn.example.com/s2.png',
    },
  ];
}

describe('LogoGridWidget', function logoGridWidget() {
  beforeEach(function reset() {
    vi.clearAllMocks();
    streamingMocks.isStreaming = false;
    streamingMocks.isLoading = false;
    mockSendUserMessage.mockReset();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    vi.spyOn(document, 'getElementById').mockReturnValue(null);
  });

  describe('#getLogoDisplayUrl', function getLogoDisplayUrlTests() {
    it('uses solid fallbacks after transparent variants', function solidFallback() {
      const logo: LogoData = {
        id: 'x',
        solidUrl: 'https://cdn.example.com/s.png',
        watermarkedSolidUrl: 'https://cdn.example.com/ws.png',
      };
      expect(getLogoDisplayUrl(logo)).toBe('https://cdn.example.com/s.png');
    });
  });

  describe('Save', function saveTests() {
    it('disables Save while streaming', function saveDisabledWhenStreaming() {
      streamingMocks.isStreaming = true;
      streamingMocks.isLoading = false;
      renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      expect(screen.getByRole('button', { name: 'builder_common_save' })).toBeDisabled();
    });

    it('disables Save while loading without streaming', function saveDisabledWhenLoadingOnly() {
      streamingMocks.isStreaming = false;
      streamingMocks.isLoading = true;
      renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      expect(screen.getByRole('button', { name: 'builder_common_save' })).toBeDisabled();
    });

    it('sets generic error when no savable URL matches display fallbacks', async function noAssetUrl() {
      const logos: LogoData[] = [{ id: 'empty', mockupUrl: 'https://cdn.example.com/m.png' }];
      const { user } = renderWithProviders(<LogoGridWidget logos={logos} />);
      await user.click(screen.getByRole('button', { name: 'builder_common_save' }));
      expect(await screen.findByText('builder_common_error_generic')).toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('swaps with solidUrl when that is the only display URL', async function solidOnlySwap() {
      const logos: LogoData[] = [
        {
          id: '1',
          solidUrl: 'https://cdn.example.com/only-solid.png',
        },
      ];
      const { user } = renderWithProviders(<LogoGridWidget logos={logos} />);
      await user.click(screen.getByRole('button', { name: 'builder_common_save' }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      const init = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit | undefined;
      expect(JSON.parse(String(init?.body))).toEqual({ newUrl: 'https://cdn.example.com/only-solid.png' });
    });

    it('shows next-step suggestions after save without sending chat until Apply is chosen', async function suggestionsAfterSave() {
      const { user } = renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      await user.click(screen.getByRole('button', { name: 'builder_common_save' }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      expect(mockSendUserMessage).not.toHaveBeenCalled();
      expect(await screen.findByText(/Logo saved\. What would you like to do next\?/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Apply logo across the site/ }));
      await waitFor(() => {
        expect(mockSendUserMessage).toHaveBeenCalledWith(
          'Apply logo across the site',
          expect.objectContaining({
            isActionRequest: true,
            customContext: expect.objectContaining({
              type: 'logo_slot_placement',
              persistence: 'ephemeral',
              source: 'logo-grid-widget',
            }),
          })
        );
      });
    });

    it('dismisses suggestions without sending a chat message', async function dismissSuggestions() {
      const { user } = renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      await user.click(screen.getByRole('button', { name: 'builder_common_save' }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      expect(await screen.findByText(/Logo saved\. What would you like to do next\?/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Not now/ }));
      expect(screen.queryByText(/Logo saved\. What would you like to do next\?/)).not.toBeInTheDocument();
      expect(mockSendUserMessage).not.toHaveBeenCalled();
    });

    it('hides post-save suggestions when a follow-up save fails', async function suggestionsClearedOnResaveFail() {
      const { user } = renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      await user.click(screen.getByRole('button', { name: 'builder_common_save' }));
      expect(await screen.findByText(/Logo saved\. What would you like to do next\?/)).toBeInTheDocument();

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Swap failed on retry' }),
      } as Response);

      await user.click(screen.getByRole('button', { name: 'builder_common_save' }));
      expect(screen.queryByText(/Logo saved\. What would you like to do next\?/)).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByText('Swap failed on retry')).toBeInTheDocument();
      });
    });

    it('does not send placement message when swap fails', async function noMessageOnSwapFail() {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Invalid URL or alternative index' }),
      } as Response);
      const { user } = renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      await user.click(screen.getByRole('button', { name: 'builder_common_save' }));
      await waitFor(() => {
        expect(screen.getByText('Invalid URL or alternative index')).toBeInTheDocument();
      });
      expect(mockSendUserMessage).not.toHaveBeenCalled();
    });

    it('does not send placement message when sendUserMessage is unavailable', async function noChatContext() {
      const { useSendUserMessage } = await import('@/app/[market]/develop/components/chat/ChatContext');
      vi.mocked(useSendUserMessage).mockReturnValueOnce(null);
      const { user } = renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      await user.click(screen.getByRole('button', { name: 'builder_common_save' }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      expect(mockSendUserMessage).not.toHaveBeenCalled();
    });
  });
});

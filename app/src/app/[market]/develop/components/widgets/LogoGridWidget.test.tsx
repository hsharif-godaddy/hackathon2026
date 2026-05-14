/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { getLogoDisplayUrl, getLogoSlotName, getLogoSlotNames, getLogoSolidDisplayUrl, type LogoData } from './logo-utils';
import LogoGridWidget from './LogoGridWidget';

const { streamingMocks } = vi.hoisted(() => ({
  streamingMocks: { isStreaming: false, isLoading: false },
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
      horizontalTransparentUrl: 'https://cdn.example.com/h1.png',
      horizontalSolidUrl: 'https://cdn.example.com/hs1.png',
      ...overrides,
    },
    {
      id: '2',
      horizontalTransparentUrl: 'https://cdn.example.com/h2.png',
      horizontalSolidUrl: 'https://cdn.example.com/hs2.png',
    },
    {
      id: '3',
      horizontalTransparentUrl: 'https://cdn.example.com/h3.png',
      horizontalSolidUrl: 'https://cdn.example.com/hs3.png',
    },
  ];
}

describe('LogoGridWidget', function logoGridWidget() {
  beforeEach(function reset() {
    vi.clearAllMocks();
    streamingMocks.isStreaming = false;
    streamingMocks.isLoading = false;
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

    it('falls back to horizontal transparent URL when square is missing', function horizontalFallback() {
      const logo: LogoData = {
        id: 'h1',
        horizontalTransparentUrl: 'https://cdn.example.com/ht.png',
        horizontalSolidUrl: 'https://cdn.example.com/hs.png',
      };
      expect(getLogoDisplayUrl(logo)).toBe('https://cdn.example.com/ht.png');
    });

    it('falls back to vertical transparent URL when square and horizontal are missing', function verticalFallback() {
      const logo: LogoData = {
        id: 'v1',
        verticalTransparentUrl: 'https://cdn.example.com/vt.png',
      };
      expect(getLogoDisplayUrl(logo)).toBe('https://cdn.example.com/vt.png');
    });
  });

  describe('#getLogoSolidDisplayUrl', function getLogoSolidDisplayUrlTests() {
    it('prefers square solid over every other variant', function squareSolidWins() {
      const logo: LogoData = {
        id: 'all',
        solidUrl: 'https://cdn.example.com/s.png',
        horizontalSolidUrl: 'https://cdn.example.com/hs.png',
        verticalSolidUrl: 'https://cdn.example.com/vs.png',
        watermarkedSolidUrl: 'https://cdn.example.com/ws.png',
        transparentUrl: 'https://cdn.example.com/t.png',
        horizontalTransparentUrl: 'https://cdn.example.com/ht.png',
        verticalTransparentUrl: 'https://cdn.example.com/vt.png',
        url: 'https://cdn.example.com/u.png',
        watermarkedTransparentUrl: 'https://cdn.example.com/wt.png',
      };
      expect(getLogoSolidDisplayUrl(logo)).toBe('https://cdn.example.com/s.png');
    });

    it('falls back to horizontal solid when square solid is missing', function horizontalSolidFallback() {
      const logo: LogoData = {
        id: 'h',
        horizontalSolidUrl: 'https://cdn.example.com/hs.png',
        verticalSolidUrl: 'https://cdn.example.com/vs.png',
        transparentUrl: 'https://cdn.example.com/t.png',
      };
      expect(getLogoSolidDisplayUrl(logo)).toBe('https://cdn.example.com/hs.png');
    });

    it('falls back to vertical solid when square and horizontal solid are missing', function verticalSolidFallback() {
      const logo: LogoData = {
        id: 'v',
        verticalSolidUrl: 'https://cdn.example.com/vs.png',
        transparentUrl: 'https://cdn.example.com/t.png',
      };
      expect(getLogoSolidDisplayUrl(logo)).toBe('https://cdn.example.com/vs.png');
    });

    it('falls back to watermarked solid before any transparent variant', function watermarkedSolidBeatsTransparent() {
      const logo: LogoData = {
        id: 'ws',
        watermarkedSolidUrl: 'https://cdn.example.com/ws.png',
        transparentUrl: 'https://cdn.example.com/t.png',
        horizontalTransparentUrl: 'https://cdn.example.com/ht.png',
        url: 'https://cdn.example.com/u.png',
      };
      expect(getLogoSolidDisplayUrl(logo)).toBe('https://cdn.example.com/ws.png');
    });

    it('falls through to square transparent when no solid variant is present', function transparentFallback() {
      const logo: LogoData = {
        id: 't',
        transparentUrl: 'https://cdn.example.com/t.png',
        horizontalTransparentUrl: 'https://cdn.example.com/ht.png',
        url: 'https://cdn.example.com/u.png',
        watermarkedTransparentUrl: 'https://cdn.example.com/wt.png',
      };
      expect(getLogoSolidDisplayUrl(logo)).toBe('https://cdn.example.com/t.png');
    });

    it('falls through to legacy url when no solid or oriented transparent is present', function legacyUrlFallback() {
      const logo: LogoData = {
        id: 'legacy',
        url: 'https://cdn.example.com/u.png',
        watermarkedTransparentUrl: 'https://cdn.example.com/wt.png',
      };
      expect(getLogoSolidDisplayUrl(logo)).toBe('https://cdn.example.com/u.png');
    });

    it('returns watermarked transparent as the last resort', function watermarkedTransparentLast() {
      const logo: LogoData = {
        id: 'wt-only',
        watermarkedTransparentUrl: 'https://cdn.example.com/wt.png',
      };
      expect(getLogoSolidDisplayUrl(logo)).toBe('https://cdn.example.com/wt.png');
    });

    it('returns undefined when no URL fields are populated', function undefinedFallback() {
      const logo: LogoData = { id: 'empty' };
      expect(getLogoSolidDisplayUrl(logo)).toBeUndefined();
    });
  });

  describe('#getLogoSlotName', function getLogoSlotNameTests() {
    it('returns logo/primary for square logos', function squareSlot() {
      const logo: LogoData = { id: 's1', transparentUrl: 'https://cdn.example.com/t.png' };
      expect(getLogoSlotName(logo)).toBe('logo/primary');
    });

    it('returns logo/horizontal for horizontal-only logos', function horizontalSlot() {
      const logo: LogoData = { id: 'h1', horizontalTransparentUrl: 'https://cdn.example.com/ht.png' };
      expect(getLogoSlotName(logo)).toBe('logo/horizontal');
    });

    it('returns logo/vertical for vertical-only logos', function verticalSlot() {
      const logo: LogoData = { id: 'v1', verticalTransparentUrl: 'https://cdn.example.com/vt.png' };
      expect(getLogoSlotName(logo)).toBe('logo/vertical');
    });

    it('returns logo/primary when logo has both square and horizontal URLs', function squarePriority() {
      const logo: LogoData = {
        id: 'both',
        transparentUrl: 'https://cdn.example.com/t.png',
        horizontalTransparentUrl: 'https://cdn.example.com/ht.png',
      };
      expect(getLogoSlotName(logo)).toBe('logo/primary');
    });

    it('returns logo/primary for empty logo', function emptyFallback() {
      const logo: LogoData = { id: 'empty' };
      expect(getLogoSlotName(logo)).toBe('logo/primary');
    });
  });

  describe('#getLogoSlotNames', function getLogoSlotNamesTests() {
    it('returns all populated orientation slots', function allOrientations() {
      const logo: LogoData = {
        id: 'all',
        transparentUrl: 'https://cdn.example.com/t.png',
        horizontalTransparentUrl: 'https://cdn.example.com/ht.png',
        verticalTransparentUrl: 'https://cdn.example.com/vt.png',
      };
      expect(getLogoSlotNames(logo)).toEqual(['logo/primary', 'logo/horizontal', 'logo/vertical']);
    });

    it('returns only populated slots', function partialOrientations() {
      const logo: LogoData = { id: 'h1', horizontalSolidUrl: 'https://cdn.example.com/hs.png' };
      expect(getLogoSlotNames(logo)).toEqual(['logo/horizontal']);
    });

    it('falls back to logo/primary for empty logo', function emptyFallback() {
      const logo: LogoData = { id: 'empty' };
      expect(getLogoSlotNames(logo)).toEqual(['logo/primary']);
    });
  });

  describe('Layout', function layoutTests() {
    it('renders logos stacked vertically', function stackedLayout() {
      renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      const images = screen.getAllByRole('img');
      expect(images).toHaveLength(3);
    });

    it('does not render More Options or Save buttons', function noButtons() {
      renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      expect(screen.queryByText('builder_common_more_options')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_common_save')).not.toBeInTheDocument();
    });

    it('does not render helper text', function noHelperText() {
      renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      expect(screen.queryByText(/Click a logo/)).not.toBeInTheDocument();
    });
  });

  describe('Click to save', function clickToSaveTests() {
    it('auto-saves to slot when logo is clicked', async function autoSave() {
      const { user } = renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[1]!);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
      expect(url).toContain('/media/app-123/slots/logo/horizontal');
      const init = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(init.body))).toEqual({ newUrl: 'https://cdn.example.com/h2.png' });
    });

    it('disables buttons while streaming', function disabledWhenStreaming() {
      streamingMocks.isStreaming = true;
      renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      const buttons = screen.getAllByRole('button');
      buttons.forEach(btn => expect(btn).toBeDisabled());
    });

    it('shows error when swap fails', async function showsError() {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Swap failed' }),
      } as Response);
      const { user } = renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[0]!);
      await waitFor(() => {
        expect(screen.getByText('Swap failed')).toBeInTheDocument();
      });
    });

    it('does not swap to solid variant when logo has no transparent URLs', async function noSolidFallback() {
      const solidOnly: LogoData[] = [
        {
          id: 'solid-only',
          solidUrl: 'https://cdn.example.com/s1.png',
          horizontalSolidUrl: 'https://cdn.example.com/hs1.png',
        },
        baseLogos()[0]!,
      ];
      const { user } = renderWithProviders(<LogoGridWidget logos={solidOnly} />);
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[0]!);
      await waitFor(() => {
        expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('aborts remaining slot swaps after a failure', async function abortsOnFailure() {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: 'Primary failed' }),
        } as Response);
      const multiOrientation: LogoData[] = [
        {
          id: 'multi',
          transparentUrl: 'https://cdn.example.com/t.png',
          horizontalTransparentUrl: 'https://cdn.example.com/ht.png',
          verticalTransparentUrl: 'https://cdn.example.com/vt.png',
        },
        baseLogos()[1]!,
      ];
      const { user } = renderWithProviders(<LogoGridWidget logos={multiOrientation} />);
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[0]!);
      await waitFor(() => {
        expect(screen.getByText('Primary failed')).toBeInTheDocument();
      });
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    });
  });

  describe('Auto-select single logo', function autoSelectTests() {
    it('auto-saves without user interaction when exactly one logo is rendered', async function autoSaveSingle() {
      const single: LogoData[] = [baseLogos()[0]!];
      renderWithProviders(<LogoGridWidget logos={single} />);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
      expect(url).toContain('/media/app-123/slots/logo/horizontal');
      const init = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(init.body))).toEqual({ newUrl: 'https://cdn.example.com/h1.png' });
    });

    it('does not auto-save when rendered with multiple logos', async function noAutoSaveMulti() {
      renderWithProviders(<LogoGridWidget logos={baseLogos()} />);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not auto-save while streaming is active', async function waitsForStreaming() {
      streamingMocks.isStreaming = true;
      const single: LogoData[] = [baseLogos()[0]!];
      renderWithProviders(<LogoGridWidget logos={single} />);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('re-fires auto-save when a new single-logo batch arrives', async function refiresOnNewBatch() {
      const first: LogoData[] = [baseLogos()[0]!];
      const second: LogoData[] = [{
        id: 'regenerated',
        horizontalTransparentUrl: 'https://cdn.example.com/regen.png',
      }];
      const { rerender } = renderWithProviders(<LogoGridWidget logos={first} />);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });
      rerender(<LogoGridWidget logos={second} />);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });
      const secondCallBody = JSON.parse(String((vi.mocked(global.fetch).mock.calls[1]?.[1] as RequestInit).body));
      expect(secondCallBody).toEqual({ newUrl: 'https://cdn.example.com/regen.png' });
    });
  });
});

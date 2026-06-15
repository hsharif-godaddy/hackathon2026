/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { LOGO_DESIGNER_TEMPLATE } from '@/app/[market]/components/types';
import HeroExamples from '@/components/home-page/HeroExamples';
import { readPendingDesignChoice } from '@/lib/rebuild-design-choice';
import { renderWithProviders } from '@/tests/test-utils';

const mockLogEngagement = vi.hoisted(() => vi.fn());
const mockUseSwitchboard = vi.hoisted(() => vi.fn(function () { return undefined; }));

vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ cohort: 'c', logAnalytics: mockLogEngagement }),
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: false,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: mockUseSwitchboard,
  getSwitchboardFlag: mockUseSwitchboard,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (id: string) => id,
  logClickEvent: vi.fn(function () { return vi.fn(); }),
}));

// Isolate HeroExamples' wiring from the real modal: expose two select buttons.
vi.mock('@/app/[market]/components/RebuildDesignModal', () => ({
  default: ({ open, onSelect }: { open: boolean; onSelect: (d: string, url: string) => void }) =>
    open ? (
      <div data-testid="rebuild-design-modal">
        <button data-testid="mock-select-modernize" onClick={() => onSelect('modernize', 'https://test.com')}>m</button>
        <button data-testid="mock-select-keep" onClick={() => onSelect('keep-similar', '')}>k</button>
      </div>
    ) : null,
}));

const REBUILD_TITLE = 'builder_homepage_examples_rebuild_title';
const REBUILD_PROMPT = 'builder_homepage_examples_rebuild_prompt';

function getRebuildButton(): HTMLElement {
  return screen.getByText(REBUILD_TITLE).closest('button') as HTMLElement;
}

describe('HeroExamples', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
  });

  describe('rebuild design branch', () => {
    it('opens the design modal instead of typing the prompt when the rebuild chip is clicked', async () => {
      mockUseSwitchboard.mockReturnValue(false);
      const onExampleClick = vi.fn();
      const { user } = renderWithProviders(<HeroExamples onExampleClick={onExampleClick} />);

      await waitFor(() => {
        expect(screen.getByText(REBUILD_TITLE)).toBeInTheDocument();
      }, { timeout: 4000 });

      await user.click(getRebuildButton());

      expect(screen.getByTestId('rebuild-design-modal')).toBeInTheDocument();
      expect(onExampleClick).not.toHaveBeenCalled();
    });

    it('persists the choice and types an enriched prompt when Reimagine is selected', async () => {
      mockUseSwitchboard.mockReturnValue(false);
      const onExampleClick = vi.fn();
      const { user } = renderWithProviders(<HeroExamples onExampleClick={onExampleClick} />);

      await waitFor(() => {
        expect(screen.getByText(REBUILD_TITLE)).toBeInTheDocument();
      }, { timeout: 4000 });

      await user.click(getRebuildButton());
      await user.click(screen.getByTestId('mock-select-modernize'));

      expect(readPendingDesignChoice()).toBe('modernize');
      expect(onExampleClick).toHaveBeenCalledTimes(1);
      // Base rebuild prompt preserved (rebuild detection) + URL + direction hint.
      const typed = onExampleClick.mock.calls[0][0] as string;
      expect(typed).toContain(REBUILD_PROMPT);
      expect(typed).toContain('https://test.com');
      expect(typed.length).toBeGreaterThan(REBUILD_PROMPT.length);
      expect(screen.queryByTestId('rebuild-design-modal')).not.toBeInTheDocument();
    });

    it('persists keep-similar when Keep my current look is selected', async () => {
      mockUseSwitchboard.mockReturnValue(false);
      const onExampleClick = vi.fn();
      const { user } = renderWithProviders(<HeroExamples onExampleClick={onExampleClick} />);

      await waitFor(() => {
        expect(screen.getByText(REBUILD_TITLE)).toBeInTheDocument();
      }, { timeout: 4000 });

      await user.click(getRebuildButton());
      await user.click(screen.getByTestId('mock-select-keep'));

      expect(readPendingDesignChoice()).toBe('keep-similar');
      expect(onExampleClick).toHaveBeenCalledTimes(1);
      // Empty URL → no " at <url>" fragment; just the base prompt + the direction hint.
      const typed = onExampleClick.mock.calls[0][0] as string;
      expect(typed).toContain(REBUILD_PROMPT);
      expect(typed).not.toContain(' at ')
    });

    it('leaves non-rebuild chips unchanged (types prompt directly, no modal)', async () => {
      mockUseSwitchboard.mockReturnValue(false);
      const onExampleClick = vi.fn();
      const { user } = renderWithProviders(<HeroExamples onExampleClick={onExampleClick} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('homepage-suggestion-button').length).toBeGreaterThan(0);
      }, { timeout: 4000 });

      const nonRebuild = screen
        .getAllByTestId('homepage-suggestion-button')
        .find((btn) => !btn.textContent?.includes(REBUILD_TITLE)) as HTMLElement;

      await user.click(nonRebuild);

      expect(onExampleClick).toHaveBeenCalledTimes(1);
      expect(onExampleClick.mock.calls[0][0]).toMatch(/_prompt$/);
      expect(screen.queryByTestId('rebuild-design-modal')).not.toBeInTheDocument();
    });
  });

  it('does not render logo button when flag is disabled', async () => {
    mockUseSwitchboard.mockReturnValue(false);

    renderWithProviders(<HeroExamples onExampleClick={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('homepage-suggestion-button').length).toBeGreaterThan(0);
    }, { timeout: 4000 });

    expect(screen.queryByTestId('homepage-logo-suggestion-button')).not.toBeInTheDocument();
  });

  it('renders logo button when flag is enabled', async () => {
    mockUseSwitchboard.mockReturnValue(true);

    renderWithProviders(<HeroExamples onExampleClick={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('homepage-logo-suggestion-button')).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('calls onExampleClick and onTemplateChange when logo button is clicked', async () => {
    mockUseSwitchboard.mockReturnValue(true);

    const onExampleClick = vi.fn();
    const onTemplateChange = vi.fn();
    const { user } = renderWithProviders(
      <HeroExamples onExampleClick={onExampleClick} onTemplateChange={onTemplateChange} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('homepage-logo-suggestion-button')).toBeInTheDocument();
    }, { timeout: 4000 });

    await user.click(screen.getByTestId('homepage-logo-suggestion-button'));

    expect(onExampleClick).toHaveBeenCalledWith('builder_homepage_examples_logo_prompt');
    expect(onTemplateChange).toHaveBeenCalledWith(LOGO_DESIGNER_TEMPLATE);
    expect(mockLogEngagement).toHaveBeenCalledWith(
      'homepage.template.click',
      { templateSlug: LOGO_DESIGNER_TEMPLATE },
    );
  });

  it('does not throw when logo button is clicked without onTemplateChange', async () => {
    mockUseSwitchboard.mockReturnValue(true);

    const onExampleClick = vi.fn();
    const { user } = renderWithProviders(
      <HeroExamples onExampleClick={onExampleClick} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('homepage-logo-suggestion-button')).toBeInTheDocument();
    }, { timeout: 4000 });

    await user.click(screen.getByTestId('homepage-logo-suggestion-button'));

    expect(onExampleClick).toHaveBeenCalledWith('builder_homepage_examples_logo_prompt');
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom';

import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useIsMobile } from '@/hooks/useIsMobile';
import AiroControlsWhatsNewModal from './AiroControlsWhatsNewModal';

const instrumentationMocks = vi.hoisted(
  (): {
    logClickEvent: ReturnType<typeof vi.fn>;
    logImpressionEvent: ReturnType<typeof vi.fn>;
  } => ({
    logClickEvent: vi.fn((): (() => void) => vi.fn()),
    logImpressionEvent: vi.fn((): (() => void) => vi.fn()),
  })
);

vi.mock('@ux/icon/x', () => ({
  default: () => <span data-testid="icon-x" />,
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations:
    () =>
    (
      key: string,
      values?: Record<string, string | ((chunks: string) => ReactNode)>,
      fallback?: string
    ): ReactNode => {
      if (!fallback) return key;
      if (!values) return fallback;
      const bold: string | ((chunks: string) => ReactNode) | undefined = values.b;
      if (typeof bold === 'function' && fallback.includes('<b>')) {
        const parts: string[] = fallback.split(/(<b>.*?<\/b>)/);
        return parts.map((part: string): ReactNode => {
          if (!part.startsWith('<b>')) return part;
          return bold(part.replace('<b>', '').replace('</b>', ''));
        });
      }
      return Object.entries(values).reduce((message: string, [name, value]): string => {
        if (typeof value !== 'string') return message;
        return message.replace(`{${name}}`, value);
      }, fallback);
    },
}));

vi.mock('@/utils/instrumentation', () => instrumentationMocks);

describe('AiroControlsWhatsNewModal', () => {
  beforeEach((): void => {
    vi.mocked(useIsMobile).mockReturnValue(false);
  });

  afterEach((): void => {
    vi.clearAllMocks();
  });

  it('renders the what is new modal from the Figma design', () => {
    render(<AiroControlsWhatsNewModal open onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Explore new Airo controls' })).toBeInTheDocument();
    expect(
      document.querySelector('.fixed.inset-0.bg-intents-ux-boxHighContrastOverlay-backgroundColor')
    ).toBeInTheDocument();
    expect(document.querySelector('link[href*="fonts.googleapis.com"]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toolbar' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Toolbar' })).toHaveClass(
      'bg-[color-mix(in_srgb,var(--color-ai)_12%,white)]',
      'text-[var(--color-ai)]'
    );
    expect(screen.getByText('Tools where you need them')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The dynamic toolbar knows what you’re working on and shows relevant actions for your project.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: Tabs' })).toBeInTheDocument();
    expect(instrumentationMocks.logImpressionEvent).toHaveBeenCalledWith(
      'develop.whats_new_modal.view',
      { device: 'desktop', step: 'toolbar', stepIndex: 0 }
    );
  });

  it('uses mobile-specific tabs, copy, and final action at the mobile breakpoint', async () => {
    const onClose = vi.fn();

    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<AiroControlsWhatsNewModal open onClose={onClose} />);

    await waitFor((): void => {
      expect(screen.getByRole('button', { name: 'Switcher' })).toHaveAttribute(
        'aria-current',
        'step'
      );
    });
    expect(screen.queryByRole('button', { name: 'Toolbar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Annotation' })).not.toBeInTheDocument();
    expect(screen.getByText('Switch between tasks')).toBeInTheDocument();
    expect(screen.getByText('Switcher', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: Chat' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next: Chat' }));
    expect(screen.getByText('Chat stays with you')).toBeInTheDocument();
    expect(screen.getByText('Chat', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: Edit' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next: Edit' }));
    expect(screen.getByText('Edit mode for inline control')).toBeInTheDocument();
    expect(screen.getByText('Edit', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(instrumentationMocks.logClickEvent).toHaveBeenCalledWith(
      'develop.whats_new_modal.got_it',
      { device: 'mobile', step: 'mobile-edit', stepIndex: 2 }
    );
  });

  it('logs modal navigation and dismissal analytics', () => {
    const onClose = vi.fn();

    render(<AiroControlsWhatsNewModal open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tabs' }));
    expect(instrumentationMocks.logClickEvent).toHaveBeenCalledWith('develop.whats_new_modal.tab', {
      device: 'desktop',
      fromStep: 'toolbar',
      fromIndex: 0,
      toStep: 'tabs',
      toIndex: 1,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next: Floating Chat' }));
    expect(instrumentationMocks.logClickEvent).toHaveBeenCalledWith(
      'develop.whats_new_modal.next',
      {
        device: 'desktop',
        fromStep: 'tabs',
        fromIndex: 1,
        toStep: 'floating-chat',
        toIndex: 2,
      }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(instrumentationMocks.logClickEvent).toHaveBeenCalledWith(
      'develop.whats_new_modal.close',
      { device: 'desktop', step: 'floating-chat', stepIndex: 2, method: 'button' }
    );

    fireEvent(
      screen.getByRole('dialog', { name: 'Explore new Airo controls' }),
      new Event('cancel', { cancelable: true })
    );
    expect(instrumentationMocks.logClickEvent).toHaveBeenCalledWith(
      'develop.whats_new_modal.close',
      { device: 'desktop', step: 'floating-chat', stepIndex: 2, method: 'escape' }
    );
  });

  it('moves between sections from the sidebar and next button', () => {
    render(<AiroControlsWhatsNewModal open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next: Tabs' }));
    expect(screen.getByRole('button', { name: 'Tabs' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Tabs to switch workspaces')).toBeInTheDocument();
    expect(screen.getByText('Tabs', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Cmd+O', { selector: 'strong' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next: Floating Chat' }));
    expect(screen.getByText('Chat moves with you')).toBeInTheDocument();
    expect(
      screen.getByText('Move the chat anywhere on the page and keep the conversation going.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: Edit' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next: Edit' }));
    expect(screen.getByText('Edit mode for inline control')).toBeInTheDocument();
    expect(screen.getByText('Edit', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: Annotation' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next: Annotation' }));
    expect(screen.getByText('Select areas to edit')).toBeInTheDocument();
    expect(screen.getByText('Select', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveClass(
      'bg-intents-ux-boxHighContrast-backgroundColor',
      'text-intents-ux-boxHighContrast-foregroundColor'
    );
    expect(screen.getByRole('button', { name: 'Got it' })).not.toHaveClass(
      'bg-intents-ux-actionControl-backgroundColor'
    );
  });

  it('closes from the close and final action buttons', () => {
    const onClose = vi.fn();
    const onComplete = vi.fn();
    const { rerender } = render(
      <AiroControlsWhatsNewModal open onClose={onClose} onComplete={onComplete} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();

    rerender(<AiroControlsWhatsNewModal open onClose={onClose} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Annotation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not render when hidden', () => {
    render(<AiroControlsWhatsNewModal open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

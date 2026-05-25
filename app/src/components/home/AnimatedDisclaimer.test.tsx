/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { AnimatedDisclaimer } from './AnimatedDisclaimer';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('react-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-intl')>();
  return {
    ...actual,
    FormattedMessage: ({ values }: { values?: Record<string, React.ReactNode> }) => (
      <span>{values?.terms ?? null}</span>
    ),
  };
});

vi.mock('@ux/button', () => ({
  default: ({ text: textProp }: { text?: string }) => <span>{textProp}</span>,
}));

vi.mock('@ux/text', () => ({
  text: {
    p: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  },
}));

describe('AnimatedDisclaimer', () => {
  it('applies visible classes when isVisible is true', () => {
    const { container } = renderWithProviders(<AnimatedDisclaimer isVisible={true} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('grid-rows-[1fr]');
    expect(wrapper).toHaveClass('opacity-100');
    expect(wrapper).not.toHaveClass('grid-rows-[0fr]');
    expect(wrapper).not.toHaveClass('opacity-0');
  });

  it('applies hidden classes when isVisible is false', () => {
    const { container } = renderWithProviders(<AnimatedDisclaimer isVisible={false} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('grid-rows-[0fr]');
    expect(wrapper).toHaveClass('opacity-0');
    expect(wrapper).not.toHaveClass('grid-rows-[1fr]');
    expect(wrapper).not.toHaveClass('opacity-100');
  });

  it('calls preventDefault on mousedown to protect textarea focus', () => {
    const { container } = renderWithProviders(<AnimatedDisclaimer isVisible={true} />);
    const wrapper = container.firstChild as HTMLElement;
    const mouseDownEvent = createEvent.mouseDown(wrapper);
    const preventDefaultSpy = vi.spyOn(mouseDownEvent, 'preventDefault');
    fireEvent(wrapper, mouseDownEvent);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('renders the terms link text', () => {
    renderWithProviders(<AnimatedDisclaimer isVisible={true} />);
    expect(screen.getByText('builder_homepage_hero_disclaimer_terms')).toBeInTheDocument();
  });
});

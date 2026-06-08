/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactElement } from 'react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const { mockUseSwitchboard } = vi.hoisted(() => ({
  mockUseSwitchboard: vi.fn(),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  default: (...args: unknown[]) => mockUseSwitchboard(...args),
  useSwitchboard: (...args: unknown[]) => mockUseSwitchboard(...args),
}));

import ThinkingTip from './ThinkingTip';

const messages = {
  builder_thinking_tip_label: 'Tip:',
  builder_tips_be_specific_description: 'Be specific about what to add or edit.',
  builder_tips_iterate_and_refine_description: 'Focus on one change at a time.',
  builder_tips_show_examples_description: 'Show examples of what you want.',
  builder_tips_start_big_picture_description: 'Set your style and layout first.',
};

function renderWithIntl(ui: ReactElement) {
  return render(
    <IntlProvider locale="en" messages={messages}>
      {ui}
    </IntlProvider>,
  );
}

describe('ThinkingTip', function test() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(function reset() {
    vi.useRealTimers();
  });

  it('renders tip when flag is ON', function on() {
    mockUseSwitchboard.mockReturnValue(true);
    const { container } = renderWithIntl(<ThinkingTip />);

    expect(container).toBeEmptyDOMElement();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('Tip:')).toBeInTheDocument();
  });

  it('renders nothing when flag is OFF', function off() {
    mockUseSwitchboard.mockReturnValue(false);
    const { container } = renderWithIntl(<ThinkingTip />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when flag is undefined', function missing() {
    mockUseSwitchboard.mockReturnValue(undefined);
    const { container } = renderWithIntl(<ThinkingTip />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('rotates tip text after TIP_DWELL_MS', function rotate() {
    mockUseSwitchboard.mockReturnValue(true);
    renderWithIntl(<ThinkingTip />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const firstTip = screen.getByTestId('thinking-tip-text').textContent;

    act(() => {
      vi.advanceTimersByTime(12300);
    });

    const secondTip = screen.getByTestId('thinking-tip-text').textContent;

    expect(secondTip).not.toBe(firstTip);
  });
});

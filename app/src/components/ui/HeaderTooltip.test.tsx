/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { type ReactNode, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { HeaderTooltip } from './HeaderTooltip';

vi.mock('@ux/tooltip', () => ({
  default: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div data-testid="tooltip" role="tooltip" data-class={className}>
      {children}
    </div>
  ),
}));

vi.mock('@ux/text', () => ({
  default: {
    div: ({
      text,
      className,
    }: {
      text?: ReactNode;
      className?: string;
    }) => <div className={className}>{text}</div>,
  },
}));

function HeaderTooltipHarness({
  label,
  description,
}: {
  label: string;
  description?: ReactNode;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef} type="button">
        Anchor
      </button>
      <HeaderTooltip anchorRef={anchorRef} label={label} description={description} />
    </>
  );
}

describe('HeaderTooltip', () => {
  it('renders the label in the tooltip', function renderLabel() {
    renderWithProviders(<HeaderTooltipHarness label="Menu label" />);

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('Menu label')).toBeInTheDocument();
  });

  it('renders description when provided', function renderDescription() {
    renderWithProviders(
      <HeaderTooltipHarness label="Menu label" description="Extra details" />,
    );

    expect(screen.getByText('Extra details')).toBeInTheDocument();
  });

  it('omits description when not provided', function omitDescription() {
    renderWithProviders(<HeaderTooltipHarness label="Menu label" />);

    expect(screen.queryByText('Extra details')).not.toBeInTheDocument();
    expect(screen.getByRole('tooltip').querySelector('.flex.flex-col')?.childElementCount).toBe(1);
  });

  it('applies develop-header-tooltip class to the tooltip', function tooltipClass() {
    renderWithProviders(<HeaderTooltipHarness label="Menu label" />);

    expect(screen.getByRole('tooltip')).toHaveAttribute(
      'data-class',
      'z-50 develop-header-tooltip',
    );
  });
});

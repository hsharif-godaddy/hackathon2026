/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { InfoTooltip } from './InfoTooltip';

vi.mock('@ux/tooltip', () => ({
  default: ({ children, id }: { children: ReactNode; id?: string }) => (
    <div data-testid="tooltip" id={id} role="tooltip">{children}</div>
  ),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('InfoTooltip', () => {
  describe('rendering', () => {
    it('should render the info icon', () => {
      const { container } = renderWithProviders(
        <InfoTooltip content="Test tooltip content" />
      );

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should not show tooltip by default', () => {
      renderWithProviders(<InfoTooltip content="Test tooltip content" />);

      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });

    it('should apply default icon className', () => {
      const { container } = renderWithProviders(
        <InfoTooltip content="Test tooltip content" />
      );

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('size-2');
      expect(svg).toHaveClass('text-intents-ux-feedbackHighContrastPassive-feedbackColor');
    });

    it('should apply custom icon className', () => {
      const { container } = renderWithProviders(
        <InfoTooltip content="Test content" iconClassName="w-4 h-4 text-red-500" />
      );

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('w-4');
      expect(svg).toHaveClass('h-4');
      expect(svg).toHaveClass('text-red-500');
    });
  });

  describe('tooltip interaction', () => {
    it('should show tooltip on mouse enter', () => {
      renderWithProviders(<InfoTooltip content="Test tooltip content" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      fireEvent.mouseEnter(trigger);

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
      expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
    });

    it('should hide tooltip on mouse leave', () => {
      renderWithProviders(<InfoTooltip content="Test tooltip content" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      fireEvent.mouseEnter(trigger);
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();

      fireEvent.mouseLeave(trigger);
      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });

    it('should show tooltip on focus (keyboard accessibility)', () => {
      renderWithProviders(<InfoTooltip content="Test tooltip content" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      fireEvent.focus(trigger);

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
      expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
    });

    it('should hide tooltip on blur', () => {
      renderWithProviders(<InfoTooltip content="Test tooltip content" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      fireEvent.focus(trigger);
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();

      fireEvent.blur(trigger);
      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });

    it('should hide tooltip on Escape key', () => {
      renderWithProviders(<InfoTooltip content="Test tooltip content" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      fireEvent.mouseEnter(trigger);
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();

      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });

    it('should be focusable via keyboard', () => {
      renderWithProviders(<InfoTooltip content="Test tooltip content" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      expect(trigger).toHaveAttribute('type', 'button');
    });
  });

  describe('accessibility', () => {
    it('should set aria-describedby when tooltip is visible', () => {
      renderWithProviders(<InfoTooltip content="Test tooltip content" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      expect(trigger).not.toHaveAttribute('aria-describedby');

      fireEvent.mouseEnter(trigger);
      expect(trigger).toHaveAttribute('aria-describedby');
    });

    it('should set aria-expanded based on tooltip visibility', () => {
      renderWithProviders(<InfoTooltip content="Test tooltip content" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      fireEvent.mouseEnter(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');

      fireEvent.mouseLeave(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('should link trigger to tooltip via aria-describedby', async () => {
      renderWithProviders(<InfoTooltip content="Test tooltip content" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      fireEvent.mouseEnter(trigger);

      await waitFor(() => {
        const tooltip = screen.getByRole('tooltip');
        const tooltipId = tooltip.getAttribute('id');
        expect(trigger).toHaveAttribute('aria-describedby', tooltipId);
      });
    });
  });

  describe('content styling', () => {
    it('should apply default content className', () => {
      renderWithProviders(<InfoTooltip content="Test content" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      fireEvent.mouseEnter(trigger);

      const contentDiv = screen.getByText('Test content');
      expect(contentDiv).toHaveClass('p-1');
      expect(contentDiv).toHaveClass('max-w-[25ch]');
      expect(contentDiv).toHaveClass('break-words');
    });

    it('should apply custom content className', () => {
      renderWithProviders(<InfoTooltip content="Test content" contentClassName="p-4 max-w-xs" />);

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      fireEvent.mouseEnter(trigger);

      const contentDiv = screen.getByText('Test content');
      expect(contentDiv).toHaveClass('p-4');
      expect(contentDiv).toHaveClass('max-w-xs');
    });
  });

  describe('embedded mode', function embeddedMode() {
    function expectVisibleTooltipContent(text: string) {
      expect(screen.getByRole('tooltip')).toHaveTextContent(text);
    }

    it('should show tooltip content on hover', async function embeddedShowsOnHover() {
      const { user } = renderWithProviders(
        <InfoTooltip embedded content="Embedded tooltip copy" />,
      );

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });

      await user.hover(trigger);
      await waitFor(
        () => {
          expectVisibleTooltipContent('Embedded tooltip copy');
        },
        { timeout: 2000 },
      );
    });

    it('should show tooltip content when trigger is focused', async function embeddedShowsOnFocus() {
      const { user } = renderWithProviders(
        <InfoTooltip embedded content="Embedded focus tip" />,
      );

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });

      await user.tab();
      expect(trigger).toHaveFocus();
      await waitFor(
        () => {
          expectVisibleTooltipContent('Embedded focus tip');
        },
        { timeout: 2000 },
      );
    });

    it('should stop click and pointerdown from bubbling', function embeddedStopsPropagation() {
      const parentClick = vi.fn();
      const parentPointerDown = vi.fn();

      renderWithProviders(
        <div onClick={parentClick} onPointerDown={parentPointerDown}>
          <InfoTooltip embedded content="Tip" />
        </div>,
      );

      const trigger = screen.getByRole('button', { name: 'builder_common_more_info' });

      fireEvent.pointerDown(trigger);
      expect(parentPointerDown).not.toHaveBeenCalled();

      fireEvent.click(trigger);
      expect(parentClick).not.toHaveBeenCalled();
    });
  });
});

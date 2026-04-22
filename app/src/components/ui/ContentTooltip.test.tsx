/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { ContentTooltip } from './ContentTooltip';

vi.mock('@ux/tooltip', () => ({
  default: ({ children, id }: { children: ReactNode; id?: string }) => (
    <div data-testid="tooltip" id={id} role="tooltip">{children}</div>
  ),
}));

describe('ContentTooltip', () => {
  describe('rendering', () => {
    it('should render children', () => {
      renderWithProviders(
        <ContentTooltip content="Tooltip text">
          <button>Trigger</button>
        </ContentTooltip>
      );

      expect(screen.getByRole('button', { name: 'Trigger' })).toBeInTheDocument();
    });

    it('should not show tooltip by default', () => {
      renderWithProviders(
        <ContentTooltip content="Tooltip text">
          <button>Trigger</button>
        </ContentTooltip>
      );

      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('tooltip interaction', () => {
    it('should show tooltip on mouse enter', () => {
      renderWithProviders(
        <ContentTooltip content="Tooltip text">
          <button>Trigger</button>
        </ContentTooltip>
      );

      fireEvent.mouseEnter(screen.getByRole('button'));
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
      expect(screen.getByText('Tooltip text')).toBeInTheDocument();
    });

    it('should hide tooltip on mouse leave', () => {
      renderWithProviders(
        <ContentTooltip content="Tooltip text">
          <button>Trigger</button>
        </ContentTooltip>
      );

      const trigger = screen.getByRole('button');
      fireEvent.mouseEnter(trigger);
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();

      fireEvent.mouseLeave(trigger);
      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });

    it('should show tooltip on focus', () => {
      renderWithProviders(
        <ContentTooltip content="Tooltip text">
          <button>Trigger</button>
        </ContentTooltip>
      );

      fireEvent.focus(screen.getByRole('button'));
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });

    it('should hide tooltip on blur', () => {
      renderWithProviders(
        <ContentTooltip content="Tooltip text">
          <button>Trigger</button>
        </ContentTooltip>
      );

      const trigger = screen.getByRole('button');
      fireEvent.focus(trigger);
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();

      fireEvent.blur(trigger);
      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });

    it('should hide tooltip on Escape key', () => {
      renderWithProviders(
        <ContentTooltip content="Tooltip text">
          <button>Trigger</button>
        </ContentTooltip>
      );

      const trigger = screen.getByRole('button');
      fireEvent.mouseEnter(trigger);
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();

      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should set aria-describedby when tooltip is visible', () => {
      renderWithProviders(
        <ContentTooltip content="Tooltip text">
          <button>Trigger</button>
        </ContentTooltip>
      );

      const trigger = screen.getByRole('button');
      expect(trigger).not.toHaveAttribute('aria-describedby');

      fireEvent.mouseEnter(trigger);
      expect(trigger).toHaveAttribute('aria-describedby');
    });

    it('should link trigger to tooltip via aria-describedby', async () => {
      renderWithProviders(
        <ContentTooltip content="Tooltip text">
          <button>Trigger</button>
        </ContentTooltip>
      );

      const trigger = screen.getByRole('button');
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
      renderWithProviders(
        <ContentTooltip content="Styled content">
          <button>Trigger</button>
        </ContentTooltip>
      );

      fireEvent.mouseEnter(screen.getByRole('button'));
      const contentDiv = screen.getByText('Styled content');
      expect(contentDiv).toHaveClass('p-1');
    });

    it('should apply custom content className', () => {
      renderWithProviders(
        <ContentTooltip content="Styled content" contentClassName="p-4 max-w-xs">
          <button>Trigger</button>
        </ContentTooltip>
      );

      fireEvent.mouseEnter(screen.getByRole('button'));
      const contentDiv = screen.getByText('Styled content');
      expect(contentDiv).toHaveClass('p-4');
      expect(contentDiv).toHaveClass('max-w-xs');
    });

    it('should render rich content', () => {
      renderWithProviders(
        <ContentTooltip content={<div data-testid="rich">Rich tooltip</div>}>
          <button>Trigger</button>
        </ContentTooltip>
      );

      fireEvent.mouseEnter(screen.getByRole('button'));
      expect(screen.getByTestId('rich')).toBeInTheDocument();
    });
  });
});

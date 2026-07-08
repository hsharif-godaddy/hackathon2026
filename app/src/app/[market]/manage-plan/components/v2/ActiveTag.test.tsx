/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import ActiveTag from './ActiveTag';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('ActiveTag', function ActiveTagTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders correctly', function renderTests() {
    it('should render the active tag text', function renderTagText() {
      renderWithProviders(<ActiveTag />);

      expect(screen.getByText('builder_manageplan_active')).toBeInTheDocument();
    });

    it('should render with success emphasis', function renderSuccessEmphasis() {
      const { container } = renderWithProviders(<ActiveTag />);

      const tag = container.querySelector('.ux-tag');
      expect(tag).toBeInTheDocument();
    });
  });

  describe('handles tooltip', function tooltipTests() {
    it('should not show tooltip when tooltipText is not provided', function noTooltipByDefault() {
      renderWithProviders(<ActiveTag />);

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('should show tooltip on mouse enter when tooltipText is provided', async function showTooltipOnHover() {
      renderWithProviders(<ActiveTag tooltipText="Test tooltip text" />);

      const tagWrapper = screen.getByText('builder_manageplan_active').closest('span[class*="cursor-pointer"]');
      expect(tagWrapper).toBeInTheDocument();

      fireEvent.mouseEnter(tagWrapper!);

      await waitFor(function waitForTooltip() {
        expect(screen.getByText('Test tooltip text')).toBeInTheDocument();
      });
    });

    it('should hide tooltip on mouse leave', async function hideTooltipOnLeave() {
      renderWithProviders(<ActiveTag tooltipText="Test tooltip text" />);

      const tagWrapper = screen.getByText('builder_manageplan_active').closest('span[class*="cursor-pointer"]');

      fireEvent.mouseEnter(tagWrapper!);

      await waitFor(function waitForTooltip() {
        expect(screen.getByText('Test tooltip text')).toBeInTheDocument();
      });

      fireEvent.mouseLeave(tagWrapper!);

      await waitFor(function waitForTooltipHide() {
        expect(screen.queryByText('Test tooltip text')).not.toBeInTheDocument();
      });
    });

    it('should have cursor-pointer class when tooltipText is provided', function hasCursorPointer() {
      renderWithProviders(<ActiveTag tooltipText="Test tooltip" />);

      const tag = screen.getByText('builder_manageplan_active').closest('.ux-tag');
      const tagWrapper = tag?.parentElement;
      expect(tagWrapper?.className).toContain('cursor-pointer');
    });

    it('should not have cursor-pointer class when tooltipText is not provided', function noCursorPointer() {
      renderWithProviders(<ActiveTag />);

      const tag = screen.getByText('builder_manageplan_active').closest('.ux-tag');
      const tagWrapper = tag?.parentElement;
      expect(tagWrapper?.className).not.toContain('cursor-pointer');
    });

    it('should not show tooltip on mouse enter when tooltipText is not provided', async function noTooltipOnHoverWithoutText() {
      renderWithProviders(<ActiveTag />);

      const tag = screen.getByText('builder_manageplan_active');
      fireEvent.mouseEnter(tag);

      await waitFor(function checkNoTooltip() {
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      });
    });
  });
});

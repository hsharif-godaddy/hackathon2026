import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import ActiveTag from './ActiveTag';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('ActiveTag', function activeTagTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders correctly', function renderTests() {
    it('should render the active tag text', function renderTagText() {
      renderWithProviders(<ActiveTag />);

      expect(screen.getByText('builder_manageplan_active')).toBeInTheDocument();
    });

    it('should render Tag component with correct styling', function renderTagStyling() {
      const { container } = renderWithProviders(<ActiveTag />);

      // The tag should have the indicator and premium emphasis
      const tag = container.querySelector('[class*="border-intents-ux-passive-borderColor"]');
      expect(tag).toBeInTheDocument();
    });
  });

  describe('handles tooltip', function tooltipTests() {
    it('should not show tooltip when tooltipText is not provided', function noTooltipText() {
      renderWithProviders(<ActiveTag />);

      // Tooltip should not be rendered
      expect(screen.queryByText('Test tooltip')).not.toBeInTheDocument();
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

    it('should have cursor-pointer class when tooltipText is provided', function cursorPointer() {
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
  });
});

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { CreditsProgressBar } from './CreditsProgressBar';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) => {
    if (params) {
      let result: string = key;
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{${k}}`, String(v));
      });
      return result;
    }
    return key;
  },
}));

describe('CreditsProgressBar', function creditsProgressBarTests() {
  describe('renders progress correctly', function renderTests() {
    it('should render with 0% progress', function zeroProgress() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={0} left={100} max={100} progressBarColor="color-ai-progress" />
      );

      const progressFill = container.querySelector('[style*="width: 0%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should render with 50% progress', function halfProgress() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" />
      );

      const progressFill = container.querySelector('[style*="width: 50%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should render with 100% progress', function fullProgress() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={100} left={0} max={100} progressBarColor="color-ai-progress" />
      );

      const progressFill = container.querySelector('[style*="width: 100%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should cap progress at 100% when spent exceeds max', function capProgress() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={150} left={0} max={100} progressBarColor="color-ai-progress" />
      );

      const progressFill = container.querySelector('[style*="width: 100%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should handle max of 0 without error', function zeroMax() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={0} max={0} progressBarColor="color-ai-progress" />
      );

      const progressFill = container.querySelector('[style*="width: 0%"]');
      expect(progressFill).toBeInTheDocument();
    });
  });

  describe('renders labels', function labelTests() {
    it('should render label text when provided', function rendersLabel() {
      renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" label="Total credits" />
      );

      expect(screen.getByText('Total credits')).toBeInTheDocument();
    });

    it('should not render label when not provided', function noLabel() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" />
      );

      expect(container.querySelector('label')).not.toBeInTheDocument();
    });

    it('should render left/max count text', function rendersLeftMax() {
      renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" />
      );

      expect(screen.getByText(/builder_manageplan_left/)).toBeInTheDocument();
    });
  });

  describe('renders size variants', function sizeTests() {
    it('should render sm size by default', function defaultSmSize() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" />
      );

      const progressBar = container.querySelector('[role="progressbar"]');
      expect(progressBar?.className).toContain('h-1.5');
    });

    it('should render md size when specified', function mdSize() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" size="md" />
      );

      const progressBar = container.querySelector('[role="progressbar"]');
      expect(progressBar?.className).toContain('h-3');
    });
  });

  describe('applies progress bar color', function colorTests() {
    it('should apply the CSS variable for progressBarColor', function appliesColor() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-bright" />
      );

      const fill = container.querySelector('[style*="width: 50%"]');
      expect(fill?.getAttribute('style')).toContain('var(--color-ai-bright)');
    });
  });

  describe('accessibility', function accessibilityTests() {
    it('should have role="progressbar"', function hasProgressbarRole() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" />
      );

      expect(container.querySelector('[role="progressbar"]')).toBeInTheDocument();
    });

    it('should have aria-valuenow', function hasAriaValueNow() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" />
      );

      expect(container.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '50');
    });

    it('should cap aria-valuenow at max', function capsAriaValueNow() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={150} left={0} max={100} progressBarColor="color-ai-progress" />
      );

      expect(container.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '100');
    });

    it('should have aria-valuemin of 0', function hasAriaValueMin() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" />
      );

      expect(container.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuemin', '0');
    });

    it('should have aria-valuemax', function hasAriaValueMax() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" />
      );

      expect(container.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuemax', '100');
    });

    it('should have aria-label', function hasAriaLabel() {
      const { container } = renderWithProviders(
        <CreditsProgressBar spent={50} left={50} max={100} progressBarColor="color-ai-progress" />
      );

      expect(container.querySelector('[role="progressbar"]')).toHaveAttribute('aria-label', 'builder_manageplan_credits_progress');
    });
  });
});

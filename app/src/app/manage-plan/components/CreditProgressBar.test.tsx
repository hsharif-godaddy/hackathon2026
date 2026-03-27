/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/tests/test-utils';
import CreditProgressBar from './CreditProgressBar';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) => {
    if (key === 'builder_manageplan_credits_count' && params) {
      return `${params.spent}/${params.max}`;
    }
    return key;
  },
}));

describe('CreditProgressBar', function creditProgressBarTests() {
  describe('renders progress correctly', function renderTests() {
    it('should render with 0% progress', function zeroProgress() {
      const { container } = renderWithProviders(<CreditProgressBar spent={0} max={100} />);

      const progressFill = container.querySelector('[style*="width: 0%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should render with 50% progress', function halfProgress() {
      const { container } = renderWithProviders(<CreditProgressBar spent={50} max={100} />);

      const progressFill = container.querySelector('[style*="width: 50%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should render with 100% progress', function fullProgress() {
      const { container } = renderWithProviders(<CreditProgressBar spent={100} max={100} />);

      const progressFill = container.querySelector('[style*="width: 100%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should cap progress at 100% when spent exceeds max', function capProgress() {
      const { container } = renderWithProviders(<CreditProgressBar spent={150} max={100} />);

      const progressFill = container.querySelector('[style*="width: 100%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should handle max of 0 without error', function zeroMax() {
      const { container } = renderWithProviders(<CreditProgressBar spent={50} max={0} />);

      const progressFill = container.querySelector('[style*="width: 0%"]');
      expect(progressFill).toBeInTheDocument();
    });
  });

  describe('handles expired state', function expiredTests() {
    it('should apply opacity class when expired', function expiredOpacity() {
      const { container } = renderWithProviders(<CreditProgressBar spent={50} max={100} isExpired={true} />);

      // The progress bar container (not the outer wrapper) has the opacity
      const progressBarContainer = container.querySelector('[class*="opacity-50"]');
      expect(progressBarContainer).toBeInTheDocument();
    });

    it('should not apply opacity class when not expired', function notExpiredOpacity() {
      const { container } = renderWithProviders(<CreditProgressBar spent={50} max={100} isExpired={false} />);

      const progressBarContainer = container.querySelector('[class*="rounded-full"]');
      expect(progressBarContainer?.className).not.toContain('opacity-50');
    });
  });

  describe('handles full state styling', function fullStateTests() {
    it('should use solid color when 100% full', function solidColorWhenFull() {
      const { container } = renderWithProviders(<CreditProgressBar spent={100} max={100} />);

      // The inner fill div should have bg-ai-light (solid) not gradient
      const progressFill = container.querySelector('[style*="width: 100%"]');
      expect(progressFill?.className).toContain('bg-ai-light');
      expect(progressFill?.className).not.toContain('gradient');
    });

    it('should use shared credit meter gradient when not full', function gradientWhenNotFull() {
      const { container } = renderWithProviders(<CreditProgressBar spent={50} max={100} />);

      const progressFill = container.querySelector('[style*="width: 50%"]');
      expect(progressFill?.getAttribute('style')).toContain('var(--credit-meter-fill-gradient)');
    });
  });

  describe('accessibility', function accessibilityTests() {
    it('should have role="progressbar" attribute', function hasProgressbarRole() {
      const { container } = renderWithProviders(<CreditProgressBar spent={50} max={100} />);

      const progressBar = container.querySelector('[role="progressbar"]');
      expect(progressBar).toBeInTheDocument();
    });

    it('should have aria-valuenow attribute with current value', function hasAriaValueNow() {
      const { container } = renderWithProviders(<CreditProgressBar spent={50} max={100} />);

      const progressBar = container.querySelector('[role="progressbar"]');
      expect(progressBar).toHaveAttribute('aria-valuenow', '50');
    });

    it('should have aria-valuemin attribute set to 0', function hasAriaValueMin() {
      const { container } = renderWithProviders(<CreditProgressBar spent={50} max={100} />);

      const progressBar = container.querySelector('[role="progressbar"]');
      expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    });

    it('should have aria-valuemax attribute with max value', function hasAriaValueMax() {
      const { container } = renderWithProviders(<CreditProgressBar spent={50} max={100} />);

      const progressBar = container.querySelector('[role="progressbar"]');
      expect(progressBar).toHaveAttribute('aria-valuemax', '100');
    });

    it('should have aria-label for screen readers', function hasAriaLabel() {
      const { container } = renderWithProviders(<CreditProgressBar spent={50} max={100} />);

      const progressBar = container.querySelector('[role="progressbar"]');
      expect(progressBar).toHaveAttribute('aria-label', 'builder_manageplan_credits_progress');
    });

    it('should cap aria-valuenow at max when spent exceeds max', function capsAriaValueNow() {
      const { container } = renderWithProviders(<CreditProgressBar spent={150} max={100} />);

      const progressBar = container.querySelector('[role="progressbar"]');
      expect(progressBar).toHaveAttribute('aria-valuenow', '100');
    });
  });
});

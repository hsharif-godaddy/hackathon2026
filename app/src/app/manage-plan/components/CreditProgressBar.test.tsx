import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import CreditProgressBar from './CreditProgressBar';

describe('CreditProgressBar', function creditProgressBarTests() {
  describe('renders progress correctly', function renderTests() {
    it('should render with 0% progress', function zeroProgress() {
      const { container } = render(<CreditProgressBar spent={0} max={100} />);

      const progressFill = container.querySelector('[style*="width: 0%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should render with 50% progress', function halfProgress() {
      const { container } = render(<CreditProgressBar spent={50} max={100} />);

      const progressFill = container.querySelector('[style*="width: 50%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should render with 100% progress', function fullProgress() {
      const { container } = render(<CreditProgressBar spent={100} max={100} />);

      const progressFill = container.querySelector('[style*="width: 100%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should cap progress at 100% when spent exceeds max', function capProgress() {
      const { container } = render(<CreditProgressBar spent={150} max={100} />);

      const progressFill = container.querySelector('[style*="width: 100%"]');
      expect(progressFill).toBeInTheDocument();
    });

    it('should handle max of 0 without error', function zeroMax() {
      const { container } = render(<CreditProgressBar spent={50} max={0} />);

      const progressFill = container.querySelector('[style*="width: 0%"]');
      expect(progressFill).toBeInTheDocument();
    });
  });

  describe('handles expired state', function expiredTests() {
    it('should apply opacity class when expired', function expiredOpacity() {
      const { container } = render(<CreditProgressBar spent={50} max={100} isExpired={true} />);

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('opacity-50');
    });

    it('should not apply opacity class when not expired', function notExpiredOpacity() {
      const { container } = render(<CreditProgressBar spent={50} max={100} isExpired={false} />);

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).not.toContain('opacity-50');
    });
  });

  describe('handles full state styling', function fullStateTests() {
    it('should use solid color when 100% full', function solidColorWhenFull() {
      const { container } = render(<CreditProgressBar spent={100} max={100} />);

      const progressFill = container.querySelector('[class*="bg-ai-light"]');
      expect(progressFill).toBeInTheDocument();
      expect(progressFill?.className).not.toContain('gradient');
    });

    it('should use gradient when not full', function gradientWhenNotFull() {
      const { container } = render(<CreditProgressBar spent={50} max={100} />);

      const progressFill = container.querySelector('[class*="gradient"]');
      expect(progressFill).toBeInTheDocument();
    });
  });
});

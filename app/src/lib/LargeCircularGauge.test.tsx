import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import LargeCircularGauge from './LargeCircularGauge';

describe('LargeCircularGauge', function largeCircularGaugeTests() {
  describe('renders correctly', function renderTests() {
    it('should render SVG element', function renderSvg() {
      const { container } = render(<LargeCircularGauge value={50} max={100} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should render with default size of 120px', function defaultSize() {
      const { container } = render(<LargeCircularGauge value={50} max={100} />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '120');
      expect(svg).toHaveAttribute('height', '120');
    });

    it('should render with custom size', function customSize() {
      const { container } = render(<LargeCircularGauge value={50} max={100} size={200} />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '200');
      expect(svg).toHaveAttribute('height', '200');
    });

    it('should render background track circle', function renderBackgroundTrack() {
      const { container } = render(<LargeCircularGauge value={50} max={100} />);

      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBeGreaterThanOrEqual(2);
    });

    it('should render progress circle', function renderProgressCircle() {
      const { container } = render(<LargeCircularGauge value={50} max={100} />);

      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];
      expect(progressCircle).toHaveAttribute('stroke-dasharray');
    });
  });

  describe('handles percentage calculations', function percentageTests() {
    it('should handle 0% correctly', function zeroPercent() {
      const { container } = render(<LargeCircularGauge value={0} max={100} />);

      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];
      const dasharray = progressCircle.getAttribute('stroke-dasharray');
      const dashoffset = progressCircle.getAttribute('stroke-dashoffset');

      // At 0%, dashoffset should equal dasharray (circumference)
      expect(dashoffset).toBe(dasharray);
    });

    it('should handle 100% correctly', function fullPercent() {
      const { container } = render(<LargeCircularGauge value={100} max={100} />);

      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];
      const dashoffset = progressCircle.getAttribute('stroke-dashoffset');

      // At 100%, dashoffset should be 0
      expect(dashoffset).toBe('0');
    });

    it('should handle max of 0 without error', function zeroMax() {
      const { container } = render(<LargeCircularGauge value={50} max={0} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should cap percentage at 100%', function capPercentage() {
      const { container } = render(<LargeCircularGauge value={150} max={100} />);

      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];
      const dashoffset = progressCircle.getAttribute('stroke-dashoffset');

      // Should be capped at 100% (dashoffset = 0)
      expect(dashoffset).toBe('0');
    });

    it('should handle negative values', function negativeValue() {
      const { container } = render(<LargeCircularGauge value={-10} max={100} />);

      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];
      const dasharray = progressCircle.getAttribute('stroke-dasharray');
      const dashoffset = progressCircle.getAttribute('stroke-dashoffset');

      // Negative values should be clamped to 0%
      expect(dashoffset).toBe(dasharray);
    });
  });

  describe('handles full state styling', function fullStateTests() {
    it('should use solid color stroke when 100% full', function solidWhenFull() {
      const { container } = render(<LargeCircularGauge value={100} max={100} />);

      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];

      // When full, should use solid color instead of gradient URL
      expect(progressCircle.getAttribute('stroke')).toBe('var(--color-ai-light)');
    });

    it('should use gradient stroke when not full', function gradientWhenNotFull() {
      const { container } = render(<LargeCircularGauge value={50} max={100} />);

      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];

      // When not full, should use gradient URL
      expect(progressCircle.getAttribute('stroke')).toMatch(/url\(#/);
    });
  });

  describe('applies custom className', function classNameTests() {
    it('should apply additional className to SVG', function additionalClassName() {
      const { container } = render(
        <LargeCircularGauge value={50} max={100} className="custom-class" />
      );

      const svg = container.querySelector('svg');
      expect(svg?.className.baseVal).toContain('custom-class');
    });
  });
});

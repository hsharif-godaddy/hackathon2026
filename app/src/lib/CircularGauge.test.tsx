import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/tests/test-utils';
import CircularGauge from './CircularGauge';

describe('CircularGauge', function circularGaugeTests() {
  describe('rendering', function renderingTests() {
    it('should render an SVG element', function renderSvg() {
      const { container } = renderWithProviders(<CircularGauge value={50} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should render two circles (track and progress)', function renderCircles() {
      const { container } = renderWithProviders(<CircularGauge value={50} />);

      const circles = container.querySelectorAll('circle');
      expect(circles).toHaveLength(2);
    });

    it('should apply default size of 20', function defaultSize() {
      const { container } = renderWithProviders(<CircularGauge value={50} />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '20');
      expect(svg).toHaveAttribute('height', '20');
    });

    it('should apply custom size', function customSize() {
      const { container } = renderWithProviders(<CircularGauge value={50} size={40} />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '40');
      expect(svg).toHaveAttribute('height', '40');
    });

    it('should apply custom className', function customClassName() {
      const { container } = renderWithProviders(
        <CircularGauge value={50} className="custom-gauge" />
      );

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('custom-gauge');
    });

    it('should have rotation class for proper orientation', function rotationClass() {
      const { container } = renderWithProviders(<CircularGauge value={50} />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('-rotate-90');
    });
  });

  describe('value handling', function valueHandlingTests() {
    it('should handle value of 0', function zeroValue() {
      const { container } = renderWithProviders(<CircularGauge value={0} />);

      const progressCircle = container.querySelectorAll('circle')[1];
      const circumference = 2 * Math.PI * 8.5; // (20 - 3) / 2
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', String(circumference));
    });

    it('should handle value of 100', function fullValue() {
      const { container } = renderWithProviders(<CircularGauge value={100} />);

      const progressCircle = container.querySelectorAll('circle')[1];
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', '0');
    });

    it('should clamp negative values to 0', function negativeValue() {
      const { container } = renderWithProviders(<CircularGauge value={-10} />);

      const progressCircle = container.querySelectorAll('circle')[1];
      const circumference = 2 * Math.PI * 8.5;
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', String(circumference));
    });

    it('should clamp values over 100 to 100', function overMaxValue() {
      const { container } = renderWithProviders(<CircularGauge value={150} />);

      const progressCircle = container.querySelectorAll('circle')[1];
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', '0');
    });

    it('should calculate correct offset for 50%', function halfValue() {
      const { container } = renderWithProviders(<CircularGauge value={50} />);

      const progressCircle = container.querySelectorAll('circle')[1];
      const circumference = 2 * Math.PI * 8.5;
      const expectedOffset = circumference * 0.5;
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', String(expectedOffset));
    });
  });

  describe('stroke configuration', function strokeTests() {
    it('should apply default stroke width of 3', function defaultStrokeWidth() {
      const { container } = renderWithProviders(<CircularGauge value={50} />);

      const circles = container.querySelectorAll('circle');
      circles.forEach(function checkStroke(circle) {
        expect(circle).toHaveAttribute('stroke-width', '3');
      });
    });

    it('should apply custom stroke width', function customStrokeWidth() {
      const { container } = renderWithProviders(
        <CircularGauge value={50} strokeWidth={5} />
      );

      const circles = container.querySelectorAll('circle');
      circles.forEach(function checkStroke(circle) {
        expect(circle).toHaveAttribute('stroke-width', '5');
      });
    });

    it('should have transition class on progress circle', function transitionClass() {
      const { container } = renderWithProviders(<CircularGauge value={50} />);

      const progressCircle = container.querySelectorAll('circle')[1];
      expect(progressCircle).toHaveClass('transition-all');
    });
  });

  describe('colors', function colorTests() {
    it('should use CSS variable for track color', function trackColor() {
      const { container } = renderWithProviders(<CircularGauge value={50} />);

      const trackCircle = container.querySelectorAll('circle')[0];
      expect(trackCircle).toHaveAttribute('stroke', 'var(--color-gauge-track, #D9D9D9)');
    });

    it('should use CSS variable for fill color', function fillColor() {
      const { container } = renderWithProviders(<CircularGauge value={50} />);

      const progressCircle = container.querySelectorAll('circle')[1];
      expect(progressCircle).toHaveAttribute('stroke', 'var(--color-ai, #613EA3)');
    });
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColorSwatchGroup } from '../ColorSwatchGroup';

const RED = { color: '#E03B2F', name: 'Red' };
const BLUE = { color: '#2F5FE0', name: 'Blue' };
const GREEN = { color: '#2FE05F', name: 'Green' };
const YELLOW = { color: '#E0C12F', name: 'Yellow' };
const PURPLE = { color: '#8F2FE0', name: 'Purple' };
const ORANGE = { color: '#E07A2F', name: 'Orange' };

describe('ColorSwatchGroup', () => {
  describe('role', () => {
    it('renders with role="group"', () => {
      render(<ColorSwatchGroup swatches={[RED]} />);
      expect(screen.getByRole('group')).toBeInTheDocument();
    });

    it('sets aria-label on the group when provided', () => {
      render(<ColorSwatchGroup swatches={[RED]} aria-label="Brand palette" />);
      expect(screen.getByRole('group', { name: 'Brand palette' })).toBeInTheDocument();
    });

    it('renders no aria-label when prop is absent', () => {
      render(<ColorSwatchGroup swatches={[RED]} />);
      expect(screen.getByRole('group')).not.toHaveAttribute('aria-label');
    });
  });

  describe('rendering all swatches (within max)', () => {
    it('renders all swatches when count equals max (5)', () => {
      const swatches = [RED, BLUE, GREEN, YELLOW, PURPLE];
      render(<ColorSwatchGroup swatches={swatches} />);
      expect(screen.getByRole('img', { name: 'Red' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Blue' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Green' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Yellow' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Purple' })).toBeInTheDocument();
    });

    it('renders no overflow when count is below max', () => {
      render(<ColorSwatchGroup swatches={[RED, BLUE, GREEN]} />);
      expect(screen.getAllByRole('img')).toHaveLength(3);
      expect(screen.queryByLabelText(/more colors/)).not.toBeInTheDocument();
    });

    it('renders exactly one swatch for a single-item array', () => {
      render(<ColorSwatchGroup swatches={[RED]} />);
      expect(screen.getAllByRole('img')).toHaveLength(1);
      expect(screen.queryByLabelText(/more colors/)).not.toBeInTheDocument();
    });
  });

  describe('truncation', () => {
    it('shows max - 1 swatches and an overflow circle when count exceeds max', () => {
      const swatches = [RED, BLUE, GREEN, YELLOW, PURPLE, ORANGE];
      render(<ColorSwatchGroup swatches={swatches} />);
      // max=5, so 4 swatches visible + 1 overflow (also role="img")
      expect(screen.getAllByRole('img')).toHaveLength(5);
      expect(screen.getByLabelText('2 more colors')).toBeInTheDocument();
    });

    it('overflow circle shows the correct +N count text', () => {
      const swatches = [RED, BLUE, GREEN, YELLOW, PURPLE, ORANGE];
      render(<ColorSwatchGroup swatches={swatches} />);
      const overflow = screen.getByLabelText('2 more colors');
      expect(overflow).toHaveTextContent('+2');
    });

    it('does not show overflow when count equals max exactly', () => {
      render(<ColorSwatchGroup swatches={[RED, BLUE, GREEN, YELLOW, PURPLE]} />);
      expect(screen.queryByLabelText(/more colors/)).not.toBeInTheDocument();
    });

    it('respects a custom max prop', () => {
      render(<ColorSwatchGroup swatches={[RED, BLUE, GREEN, YELLOW]} max={3} />);
      // max=3: 2 swatches visible + overflow showing "+2"
      expect(screen.getAllByRole('img')).toHaveLength(3);
      expect(screen.getByLabelText('2 more colors')).toBeInTheDocument();
    });

    it('uses getOverflowAriaLabel for the overflow chip when provided', () => {
      const swatches = [RED, BLUE, GREEN, YELLOW, PURPLE, ORANGE];
      render(
        <ColorSwatchGroup
          swatches={swatches}
          getOverflowAriaLabel={(count) => `${count} couleurs supplémentaires`}
        />,
      );
      expect(screen.getByLabelText('2 couleurs supplémentaires')).toBeInTheDocument();
    });

    it('does not invoke getOverflowAriaLabel when nothing is truncated', () => {
      const getOverflowAriaLabel = vi.fn(function (count: number) { return `${count} more`; });
      render(
        <ColorSwatchGroup swatches={[RED, BLUE]} getOverflowAriaLabel={getOverflowAriaLabel} />,
      );
      expect(getOverflowAriaLabel).not.toHaveBeenCalled();
    });

    it('treats max <= 0 as 1 (clamps to minimum of 1)', () => {
      // max=0 is clamped to 1: 0 visible swatches + overflow showing all
      render(<ColorSwatchGroup swatches={[RED, BLUE, GREEN]} max={0} />);
      expect(screen.getAllByRole('img')).toHaveLength(1);
      expect(screen.getByLabelText('3 more colors')).toBeInTheDocument();
    });
  });

  describe('size prop', () => {
    it('passes size through to each child ColorSwatch', () => {
      render(<ColorSwatchGroup swatches={[RED, BLUE]} size={32} />);
      const swatches = screen.getAllByRole('img');
      for (const swatch of swatches) {
        expect(swatch).toHaveStyle({ width: '32px', height: '32px' });
      }
    });

    it('applies --airo-swatch-size custom property from size prop', () => {
      render(<ColorSwatchGroup swatches={[RED]} size={40} />);
      const group = screen.getByRole('group');
      expect(group).toHaveStyle({ '--airo-swatch-size': '40px' });
    });
  });

  describe('class forwarding', () => {
    it('applies the BEM base class to the group root', () => {
      render(<ColorSwatchGroup swatches={[RED]} />);
      expect(screen.getByRole('group')).toHaveClass('airo-primitives-color-swatch-group');
    });

    it('merges consumer className with the base class', () => {
      render(<ColorSwatchGroup swatches={[RED]} className="my-group" />);
      const el = screen.getByRole('group');
      expect(el).toHaveClass('airo-primitives-color-swatch-group');
      expect(el).toHaveClass('my-group');
    });
  });

  describe('prop forwarding', () => {
    it('forwards data-* attributes to the root span', () => {
      render(<ColorSwatchGroup swatches={[RED]} data-testid="group" />);
      expect(screen.getByTestId('group')).toHaveAttribute('role', 'group');
    });
  });
});

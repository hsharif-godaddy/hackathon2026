import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ColorSwatch } from '../ColorSwatch';

describe('ColorSwatch', () => {
  describe('role', () => {
    it('renders with role="img"', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} />);
      expect(screen.getByRole('img')).toBeInTheDocument();
    });
  });

  describe('accessible label', () => {
    it('uses color.name as aria-label when provided', () => {
      render(<ColorSwatch color={{ color: '#E03B2F', name: 'Cayenne' }} />);
      expect(screen.getByRole('img', { name: 'Cayenne' })).toBeInTheDocument();
    });

    it('falls back to the color string when name is absent', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} />);
      expect(screen.getByRole('img', { name: '#E03B2F' })).toBeInTheDocument();
    });

    it('explicit aria-label prop overrides color.name', () => {
      render(
        <ColorSwatch color={{ color: '#E03B2F', name: 'Cayenne' }} aria-label="Custom label" />,
      );
      expect(screen.getByRole('img', { name: 'Custom label' })).toBeInTheDocument();
    });

    it('explicit aria-label prop overrides the color string fallback', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} aria-label="Custom label" />);
      expect(screen.getByRole('img', { name: 'Custom label' })).toBeInTheDocument();
    });
  });

  describe('tooltip', () => {
    it('sets title attribute when color.name is provided', () => {
      render(<ColorSwatch color={{ color: '#E03B2F', name: 'Cayenne' }} />);
      expect(screen.getByRole('img')).toHaveAttribute('title', 'Cayenne');
    });

    it('lets an explicit title prop override color.name', () => {
      render(<ColorSwatch color={{ color: '#E03B2F', name: 'Cayenne' }} title="Piment fort" />);
      expect(screen.getByRole('img')).toHaveAttribute('title', 'Piment fort');
    });

    it('omits title attribute when color.name is absent', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} />);
      expect(screen.getByRole('img')).not.toHaveAttribute('title');
    });
  });

  describe('sizing', () => {
    it('defaults to 24px width and height', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} />);
      const el = screen.getByRole('img');
      expect(el).toHaveStyle({ width: '24px', height: '24px' });
    });

    it('applies custom size as width and height', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} size={32} />);
      const el = screen.getByRole('img');
      expect(el).toHaveStyle({ width: '32px', height: '32px' });
    });
  });

  describe('color fill', () => {
    it('applies background-color from color.color on the inner disk', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} />);
      const fill = document.querySelector('.airo-primitives-color-swatch__fill');
      expect(fill).not.toBeNull();
      expect(fill).toHaveStyle({ backgroundColor: '#E03B2F' });
    });

    it('lets consumer style.backgroundColor override the fill color', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} style={{ backgroundColor: '#00FF00' }} />);
      const fill = document.querySelector('.airo-primitives-color-swatch__fill');
      expect(fill).toHaveStyle({ backgroundColor: '#00FF00' });
    });
  });

  describe('class forwarding', () => {
    it('applies the BEM base class', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} />);
      expect(screen.getByRole('img')).toHaveClass('airo-primitives-color-swatch');
    });

    it('merges a consumer className with the base class', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} className="my-extra" />);
      const el = screen.getByRole('img');
      expect(el).toHaveClass('airo-primitives-color-swatch');
      expect(el).toHaveClass('my-extra');
    });
  });

  describe('prop forwarding', () => {
    it('forwards data-* attributes to the root span', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} data-testid="swatch" />);
      expect(screen.getByTestId('swatch')).toHaveAttribute('role', 'img');
    });

    it('merges consumer style with component styles', () => {
      render(<ColorSwatch color={{ color: '#E03B2F' }} style={{ opacity: 0.5 }} />);
      const root = screen.getByRole('img');
      expect(root).toHaveStyle({
        width: '24px',
        height: '24px',
        opacity: '0.5',
      });
      const fill = document.querySelector('.airo-primitives-color-swatch__fill');
      expect(fill).toHaveStyle({ backgroundColor: '#E03B2F' });
    });
  });
});

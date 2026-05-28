import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FloatingFooter } from '../index';

describe('FloatingFooter', () => {
  it('renders children and root class', () => {
    const { container } = render(
      <FloatingFooter>
        <span>Toolbar</span>
      </FloatingFooter>,
    );
    expect(container.querySelector('.airo-surfaces-floating-footer')).toBeInTheDocument();
    expect(screen.getByText('Toolbar')).toBeInTheDocument();
  });

  it('forwards className to the root element', () => {
    const { container } = render(
      <FloatingFooter className="custom" data-testid="ff">
        <span>x</span>
      </FloatingFooter>,
    );
    const root = container.querySelector('.airo-surfaces-floating-footer');
    expect(root).toHaveClass('custom');
    expect(root).toHaveAttribute('data-testid', 'ff');
  });

  it('renders children inside the root element', () => {
    render(
      <FloatingFooter>
        <span data-testid="ff-child">x</span>
      </FloatingFooter>,
    );
    expect(screen.getByTestId('ff-child')).toBeInTheDocument();
  });
});

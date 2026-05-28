import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DragHandle } from '../DragHandle';

describe('DragHandle', () => {
  it('renders a horizontal pill by default', () => {
    const { container } = render(<DragHandle />);
    const root = container.querySelector('.airo-primitives-drag-handle');
    expect(root).not.toBeNull();
    expect(root?.classList.contains('airo-primitives-drag-handle--horizontal')).toBe(true);
    expect(root?.classList.contains('airo-primitives-drag-handle--vertical')).toBe(false);
  });

  it('switches to the vertical variant when orientation="vertical"', () => {
    const { container } = render(<DragHandle orientation="vertical" />);
    const root = container.querySelector('.airo-primitives-drag-handle');
    expect(root?.classList.contains('airo-primitives-drag-handle--vertical')).toBe(true);
    expect(root?.classList.contains('airo-primitives-drag-handle--horizontal')).toBe(false);
  });

  it('is decorative — always aria-hidden, no role', () => {
    const { container } = render(<DragHandle />);
    const root = container.querySelector('.airo-primitives-drag-handle');
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(root?.hasAttribute('role')).toBe(false);
  });

  it('forwards id, data-*, and other HTML attributes to the root', () => {
    const { container } = render(<DragHandle id="grip" data-testid="grip" data-state="custom" />);
    const root = container.querySelector('#grip');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-testid')).toBe('grip');
    expect(root?.getAttribute('data-state')).toBe('custom');
  });

  it('merges consumer className with the BEM root class', () => {
    const { container } = render(<DragHandle className="my-handle" />);
    const root = container.querySelector('.airo-primitives-drag-handle');
    expect(root?.classList.contains('my-handle')).toBe(true);
  });
});

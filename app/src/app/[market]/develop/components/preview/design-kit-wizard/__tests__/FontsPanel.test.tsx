// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { FontsPanel } from '../DesignKitPanels';

describe('FontsPanel', () => {
  it('reports a curated pairing (heading + body, with weights) via onApply', () => {
    const onApply = vi.fn();
    render(<FontsPanel headingName="Inter" bodyName="Inter" onApply={onApply} />);

    fireEvent.click(screen.getByTestId('pairing-elegant-serif'));

    expect(onApply).toHaveBeenCalledWith(
      { name: 'Playfair Display', weights: ['600', '700'], category: 'serif' },
      { name: 'Lora', weights: ['400', '500', '600'], category: 'serif' },
    );
  });
});

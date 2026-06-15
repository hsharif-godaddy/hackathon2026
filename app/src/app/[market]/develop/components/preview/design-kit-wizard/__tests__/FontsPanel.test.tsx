// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { FontsPanel } from '../DesignKitPanels';

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: (): { sendMessage: ReturnType<typeof vi.fn> } => ({
    sendMessage: vi.fn(async () => undefined),
  }),
}));

describe('FontsPanel', () => {
  it('reports a curated pairing (heading + body, with weights) via onApply', () => {
    const onApply = vi.fn();
    render(<FontsPanel headingName="Inter" bodyName="Inter" onApply={onApply} onRegenerate={vi.fn()} />);

    fireEvent.click(screen.getByTestId('pairing-elegant-serif'));

    expect(onApply).toHaveBeenCalledWith(
      { name: 'Playfair Display', weights: ['600', '700'], category: 'serif' },
      { name: 'Lora', weights: ['400', '500', '600'], category: 'serif' },
    );
  });

  it('fires onRegenerate from the panel action', () => {
    const onRegenerate = vi.fn();
    render(<FontsPanel headingName="Inter" bodyName="Inter" onApply={vi.fn()} onRegenerate={onRegenerate} />);

    fireEvent.click(screen.getByTestId('fonts-regenerate'));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});

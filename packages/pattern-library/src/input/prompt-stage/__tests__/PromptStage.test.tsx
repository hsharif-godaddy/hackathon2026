import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PromptStage } from '../index';

describe('PromptStage', () => {
  describe('rendering', () => {
    it('renders the root class', () => {
      const { container } = render(<PromptStage slotKey="a">content</PromptStage>);
      expect(container.querySelector('.airo-input-prompt-stage')).toBeInTheDocument();
    });

    it('renders children inside a slot', () => {
      render(
        <PromptStage slotKey="a">
          <span data-testid="child">hello</span>
        </PromptStage>,
      );
      expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('forwards className and data-* to the root element', () => {
      const { container } = render(
        <PromptStage slotKey="a" className="custom" data-testid="stage">
          content
        </PromptStage>,
      );
      const root = container.querySelector('.airo-input-prompt-stage');
      expect(root).toHaveClass('custom');
      expect(root).toHaveAttribute('data-testid', 'stage');
    });

    it('does not apply --enter class on initial render', () => {
      const { container } = render(<PromptStage slotKey="a">initial</PromptStage>);
      expect(
        container.querySelector('.airo-input-prompt-stage__slot--enter'),
      ).not.toBeInTheDocument();
    });
  });

  describe('swap animation', () => {
    function SwapHarness() {
      const [key, setKey] = useState('prompt');
      const [label, setLabel] = useState('PromptBox');
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setKey('choices');
              setLabel('ChoiceList');
            }}
          >
            swap
          </button>
          <PromptStage slotKey={key}>
            <span data-testid="active-slot">{label}</span>
          </PromptStage>
        </>
      );
    }

    it('renders the entering slot with --enter class after a key change', () => {
      const { container, getByRole } = render(<SwapHarness />);

      act(() => {
        getByRole('button', { name: 'swap' }).click();
      });

      expect(container.querySelector('.airo-input-prompt-stage__slot--enter')).toBeInTheDocument();
    });

    it('renders the exiting slot with --exit class after a key change', () => {
      const { container, getByRole } = render(<SwapHarness />);

      act(() => {
        getByRole('button', { name: 'swap' }).click();
      });

      expect(container.querySelector('.airo-input-prompt-stage__slot--exit')).toBeInTheDocument();
    });

    it('removes the exit slot after SWAP_MS', async () => {
      vi.useFakeTimers();
      const { container, getByRole } = render(<SwapHarness />);

      act(() => {
        getByRole('button', { name: 'swap' }).click();
      });

      expect(container.querySelector('.airo-input-prompt-stage__slot--exit')).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      expect(
        container.querySelector('.airo-input-prompt-stage__slot--exit'),
      ).not.toBeInTheDocument();

      vi.useRealTimers();
    });

    it('renders the new children in the active slot after swap', () => {
      const { getByRole } = render(<SwapHarness />);

      act(() => {
        getByRole('button', { name: 'swap' }).click();
      });

      // Active slot should contain the new label.
      expect(
        screen.getAllByTestId('active-slot').some((el) => el.textContent === 'ChoiceList'),
      ).toBe(true);
    });

    it('preserves the old children in the exit slot snapshot', () => {
      const { getByRole } = render(<SwapHarness />);

      act(() => {
        getByRole('button', { name: 'swap' }).click();
      });

      // Both old and new slot text should be visible during transition.
      const slots = screen.getAllByTestId('active-slot');
      const texts = slots.map((el) => el.textContent);
      expect(texts).toContain('PromptBox');
      expect(texts).toContain('ChoiceList');
    });
  });

  // Live-children pass-through is the contract that lets a controlled
  // PromptBox / SecretsForm / etc. continue to receive prop updates while
  // its slotKey is stable. Without it, the active slot would render a
  // frozen snapshot of the children captured at the last slotKey change
  // and the wrapped component would silently fall behind its parent state.
  describe('live children pass-through (stable slotKey)', () => {
    function ControlledHarness({ value }: { value: string }) {
      return (
        <PromptStage slotKey="prompt">
          <span data-testid="active-slot">{value}</span>
        </PromptStage>
      );
    }

    it('rerenders new children when slotKey is unchanged but children update', () => {
      const { rerender } = render(<ControlledHarness value="first" />);
      expect(screen.getByTestId('active-slot')).toHaveTextContent('first');

      rerender(<ControlledHarness value="second" />);
      expect(screen.getByTestId('active-slot')).toHaveTextContent('second');

      rerender(<ControlledHarness value="third" />);
      expect(screen.getByTestId('active-slot')).toHaveTextContent('third');
    });

    it('does not freeze children mid-flight across multiple parent updates', () => {
      const { rerender, container } = render(<ControlledHarness value="a" />);
      // Three rapid prop updates with the same slotKey — none should
      // trigger an exit animation or strand the active slot on stale
      // children.
      rerender(<ControlledHarness value="b" />);
      rerender(<ControlledHarness value="c" />);
      rerender(<ControlledHarness value="d" />);
      expect(screen.getByTestId('active-slot')).toHaveTextContent('d');
      expect(
        container.querySelector('.airo-input-prompt-stage__slot--exit'),
      ).not.toBeInTheDocument();
    });
  });
});

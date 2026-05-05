/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { SegmentedController, SegmentedControllerItem } from './SegmentedController';

vi.mock('@ux/icon/chevron-left', () => ({
  default: function ChevronLeft() {
    return <span data-testid="chevron-left" />;
  },
}));

vi.mock('@ux/icon/chevron-right', () => ({
  default: function ChevronRight() {
    return <span data-testid="chevron-right" />;
  },
}));

vi.mock('@ux/text', () => ({
  default: {
    span: function TextSpan({ children }: { children: ReactNode }) {
      return <span>{children}</span>;
    },
  },
}));

function ThreeSegmentHarness({
  onSelectionChange,
}: {
  onSelectionChange?: (v: string) => void;
}) {
  const [v, setV] = useState('a');
  return (
    <SegmentedController
      radiogroupProps={{ 'aria-label': 'test-radiogroup' }}
      value={v}
      onSelectionChange={(next) => {
        onSelectionChange?.(next);
        setV(next);
      }}
    >
      <SegmentedControllerItem value="a">Alpha</SegmentedControllerItem>
      <SegmentedControllerItem value="b">Bravo</SegmentedControllerItem>
      <SegmentedControllerItem value="c">Charlie</SegmentedControllerItem>
    </SegmentedController>
  );
}

function mockViewportOverflow(viewport: HTMLElement, scrollLeft: number) {
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 300 });
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
}

describe('SegmentedController', function segmentedControllerTests() {
  afterEach(function restoreGlobals() {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(function stubDomApis() {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverStub {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  describe('keyboard navigation', function keyboardNavTests() {
    it('should select next segment on ArrowRight', async function arrowRight() {
      const onSelectionChange = vi.fn();
      renderWithProviders(<ThreeSegmentHarness onSelectionChange={onSelectionChange} />);

      const radios = screen.getAllByRole('radio');
      expect(radios[0]).toHaveAttribute('aria-checked', 'true');
      fireEvent.keyDown(radios[0], { key: 'ArrowRight' });

      await waitFor(function assertBravoSelected() {
        expect(onSelectionChange).toHaveBeenCalledWith('b');
        expect(screen.getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('should wrap to first on ArrowLeft from first', async function arrowLeftWrap() {
      renderWithProviders(<ThreeSegmentHarness />);

      const radios = screen.getAllByRole('radio');
      fireEvent.keyDown(radios[0], { key: 'ArrowLeft' });

      await waitFor(function assertCharlieSelected() {
        expect(screen.getAllByRole('radio')[2]).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('should select first on Home', async function homeKey() {
      renderWithProviders(<ThreeSegmentHarness />);

      const radios = screen.getAllByRole('radio');
      fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
      await waitFor(function assertB() {
        expect(screen.getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true');
      });
      fireEvent.keyDown(screen.getAllByRole('radio')[1], { key: 'ArrowRight' });
      await waitFor(function assertC() {
        expect(screen.getAllByRole('radio')[2]).toHaveAttribute('aria-checked', 'true');
      });
      fireEvent.keyDown(screen.getAllByRole('radio')[2], { key: 'Home' });

      await waitFor(function assertA() {
        expect(screen.getAllByRole('radio')[0]).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('should select last on End', async function endKey() {
      renderWithProviders(<ThreeSegmentHarness />);

      fireEvent.keyDown(screen.getAllByRole('radio')[0], { key: 'End' });

      await waitFor(function assertLast() {
        expect(screen.getAllByRole('radio')[2]).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('should move selection on ArrowDown like ArrowRight', async function arrowDown() {
      renderWithProviders(<ThreeSegmentHarness />);

      fireEvent.keyDown(screen.getAllByRole('radio')[0], { key: 'ArrowDown' });

      await waitFor(function assertB() {
        expect(screen.getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('should move selection on ArrowUp like ArrowLeft', async function arrowUp() {
      renderWithProviders(<ThreeSegmentHarness />);

      fireEvent.keyDown(screen.getAllByRole('radio')[0], { key: 'ArrowRight' });
      await waitFor(function assertB() {
        expect(screen.getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true');
      });
      fireEvent.keyDown(screen.getAllByRole('radio')[1], { key: 'ArrowUp' });

      await waitFor(function assertA() {
        expect(screen.getAllByRole('radio')[0]).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('should not change selection when only one segment exists', function singleSegment() {
      const onSelectionChange = vi.fn();
      function OneSegmentHarness() {
        const [v, setV] = useState('only');
        return (
          <SegmentedController
            radiogroupProps={{ 'aria-label': 'one' }}
            value={v}
            onSelectionChange={(next) => {
              onSelectionChange(next);
              setV(next);
            }}
          >
            <SegmentedControllerItem value="only">Only</SegmentedControllerItem>
          </SegmentedController>
        );
      }
      renderWithProviders(<OneSegmentHarness />);

      fireEvent.keyDown(screen.getByRole('radio'), { key: 'ArrowRight' });
      expect(onSelectionChange).not.toHaveBeenCalled();
      expect(screen.getByRole('radio')).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('pointer selection', function pointerTests() {
    it('should call onSelectionChange when a different segment is clicked', async function clickSegment() {
      const onSelectionChange = vi.fn();
      const { user } = renderWithProviders(
        <SegmentedController radiogroupProps={{ 'aria-label': 'rg' }} value="a" onSelectionChange={onSelectionChange}>
          <SegmentedControllerItem value="a">A</SegmentedControllerItem>
          <SegmentedControllerItem value="b">B</SegmentedControllerItem>
        </SegmentedController>,
      );

      await user.click(screen.getByRole('radio', { name: 'B' }));

      expect(onSelectionChange).toHaveBeenCalledWith('b');
    });
  });

  describe('overflow scroll chevrons', function overflowTests() {
    it('should render chevrons when viewport is narrower than content', async function chevronsVisible() {
      renderWithProviders(<ThreeSegmentHarness />);

      const viewport = screen.getByRole('radiogroup');
      mockViewportOverflow(viewport, 0);
      fireEvent.scroll(viewport);

      await waitFor(function assertChevrons() {
        expect(screen.getByTestId('chevron-left')).toBeInTheDocument();
        expect(screen.getByTestId('chevron-right')).toBeInTheDocument();
      });
    });

    it('should disable left chevron at scroll start and right near max scroll', async function chevronDisabled() {
      renderWithProviders(<ThreeSegmentHarness />);

      const viewport = screen.getByRole('radiogroup');
      mockViewportOverflow(viewport, 0);
      fireEvent.scroll(viewport);

      await waitFor(function waitChevrons() {
        expect(screen.getByTestId('chevron-left')).toBeInTheDocument();
      });

      const buttons = screen.getAllByRole('button');
      expect(buttons[0]).toBeDisabled();
      expect(buttons[1]).not.toBeDisabled();

      mockViewportOverflow(viewport, 200);
      fireEvent.scroll(viewport);

      await waitFor(function waitRightDisabled() {
        const nextButtons = screen.getAllByRole('button');
        expect(nextButtons[1]).toBeDisabled();
      });
    });

    it('should scroll viewport when right chevron is pressed', async function chevronScroll() {
      const { user } = renderWithProviders(<ThreeSegmentHarness />);

      const viewport = screen.getByRole('radiogroup');
      const scrollByMock = vi.fn();
      viewport.scrollBy = scrollByMock as typeof viewport.scrollBy;

      mockViewportOverflow(viewport, 0);
      fireEvent.scroll(viewport);

      await waitFor(function waitChevrons() {
        expect(screen.getByTestId('chevron-right')).toBeInTheDocument();
      });

      const rightChevron = screen.getAllByRole('button')[1];
      expect(rightChevron).toHaveAttribute('aria-label', 'Scroll to more segments');
      await user.click(rightChevron);

      expect(scrollByMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth', left: expect.any(Number) }),
      );
    });
  });

  describe('ResizeObserver lifecycle', function resizeObserverTests() {
    it('should disconnect ResizeObserver on unmount', async function disconnectOnUnmount() {
      let instanceDisconnect: ReturnType<typeof vi.fn> | undefined;
      vi.unstubAllGlobals();
      vi.stubGlobal(
        'ResizeObserver',
        class TrackedResizeObserver {
          observe = vi.fn();
          unobserve = vi.fn();
          disconnect = vi.fn();
          constructor() {
            instanceDisconnect = this.disconnect;
          }
        },
      );

      const { unmount } = renderWithProviders(
        <SegmentedController radiogroupProps={{ 'aria-label': 'rg' }} value="a" onSelectionChange={vi.fn()}>
          <SegmentedControllerItem value="a">A</SegmentedControllerItem>
        </SegmentedController>,
      );

      await waitFor(function waitForObserver() {
        expect(instanceDisconnect).toBeDefined();
      });
      unmount();
      expect(instanceDisconnect).toHaveBeenCalled();
    });
  });

  describe('value edge cases', function valueEdgeTests() {
    it('should not mark any segment checked when value matches no item', function orphanValue() {
      renderWithProviders(
        <SegmentedController radiogroupProps={{ 'aria-label': 'rg' }} value="missing" onSelectionChange={vi.fn()}>
          <SegmentedControllerItem value="a">A</SegmentedControllerItem>
          <SegmentedControllerItem value="b">B</SegmentedControllerItem>
        </SegmentedController>,
      );

      screen.getAllByRole('radio').forEach(function assertNoneChecked(radio) {
        expect(radio).toHaveAttribute('aria-checked', 'false');
      });
    });
  });

  describe('SegmentedControllerItem', function itemTests() {
    it('should throw when rendered outside SegmentedController', function outsideContext() {
      expect(function expectThrow() {
        renderWithProviders(<SegmentedControllerItem value="a">A</SegmentedControllerItem>);
      }).toThrow(/SegmentedControllerItem must be used within SegmentedController/);
    });
  });
});

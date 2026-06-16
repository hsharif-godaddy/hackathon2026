/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement as reactCreateElement, useState } from 'react';
import TextColorButton from '../TextColorButton';

vi.mock('../../utils/postMessage', () => ({
  safePostMessage: vi.fn(),
}));

vi.mock('../../utils/elementStyleListeners', () => ({
  StyleMessageEventType: {
    UPDATED: 'STYLE_UPDATED',
    EDIT_FAILED: 'STYLE_EDIT_FAILED',
  },
  addStyleEditListener: vi.fn(() => 'mock-commit-id'),
}));

vi.mock('../../utils/element-helpers', () => ({
  extractDevContext: vi.fn(() => ({ devId: 'test-id', fileName: 'test.tsx', lineNumber: 1, componentName: 'Test' })),
  generatePreciseSelector: vi.fn(() => 'div > p'),
  getElementClassName: vi.fn((el: HTMLElement) => el.className),
}));

vi.mock('../../utils/translations', () => ({
  t: vi.fn((_key: string, fallback: string) => fallback),
}));

vi.mock('../../utils/text-editing-helpers', () => ({
  extractThemeColors: vi.fn(() => ['#ff0000', '#00ff00', '#0000ff']),
}));

vi.mock('../../utils/color', () => ({
  rgbToHex: vi.fn((red: number, green: number, blue: number) => {
    const toHex = (value: number) => value.toString(16).padStart(2, '0');
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
  }),
  normalizeHex: vi.fn((hex: string) => hex),
}));

vi.mock('../ColorPicker', () => ({
  default: vi.fn(({ onChange, onChangeEnd }: {
    onChange?: (hex: string) => void;
    onChangeEnd?: (hex: string) => void;
  }) =>
    reactCreateElement('div', { 'data-testid': 'color-picker' },
      reactCreateElement('button', { onClick: () => onChange?.('#ff0000') }, 'preview color'),
      reactCreateElement('button', { onClick: () => onChangeEnd?.('#ff0000') }, 'commit color'),
    )
  ),
}));

import { safePostMessage } from '../../utils/postMessage';
import { addStyleEditListener, StyleMessageEventType } from '../../utils/elementStyleListeners';

function makeParagraph(className = ''): HTMLElement {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.getBoundingClientRect = vi.fn(() => ({ top: 0, left: 0, width: 100, height: 20, right: 100, bottom: 20 } as DOMRect));
  document.body.appendChild(paragraph);
  return paragraph;
}

function ControlledTextColorButton({ selectedElement }: { selectedElement: HTMLElement | null }) {
  const [isOpen, setIsOpen] = useState(false);

  return reactCreateElement(TextColorButton, {
    selectedElement,
    isOpen,
    onOpenChange: setIsOpen,
  });
}

function renderTextColorButton(selectedElement: HTMLElement | null) {
  return render(reactCreateElement(ControlledTextColorButton, { selectedElement }));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('TextColorButton', () => {
  describe('rendering', () => {
    it('renders the toolbar button', () => {
      const paragraph = makeParagraph();
      renderTextColorButton(paragraph);
      expect(screen.getByRole('button', { name: 'Text color' })).not.toBeNull();
    });

    it('does not show the color picker by default', () => {
      const paragraph = makeParagraph();
      renderTextColorButton(paragraph);
      expect(screen.queryByTestId('color-picker')).toBeNull();
    });

    it('renders with null selectedElement without crashing', () => {
      const { container } = renderTextColorButton(null);
      expect(container.firstChild).not.toBeNull();
    });
  });

  describe('menu toggle', () => {
    it('opens the color picker when the toolbar button is clicked', () => {
      const paragraph = makeParagraph();
      renderTextColorButton(paragraph);
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      expect(screen.getByTestId('color-picker')).not.toBeNull();
    });

    it('closes the color picker when the toolbar button is clicked again', () => {
      const paragraph = makeParagraph();
      renderTextColorButton(paragraph);
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      expect(screen.queryByTestId('color-picker')).toBeNull();
    });
  });

  describe('color preview', () => {
    it('updates element style.color on preview without posting a message', () => {
      const paragraph = makeParagraph();
      renderTextColorButton(paragraph);
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      fireEvent.click(screen.getByRole('button', { name: 'preview color' }));
      expect(paragraph.style.color).toBe('rgb(255, 0, 0)');
      expect(safePostMessage).not.toHaveBeenCalled();
    });
  });

  describe('color commit', () => {
    it('fires devtools.toolbar.text_color click track event on commit (not on preview)', () => {
      const paragraph = makeParagraph();
      renderTextColorButton(paragraph);
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      const trackCalls = () =>
        vi.mocked(safePostMessage).mock.calls.filter(
          ([, msg]) => (msg as { type?: string })?.type === 'TRACK_EVENT',
        );
      fireEvent.click(screen.getByRole('button', { name: 'preview color' }));
      expect(trackCalls()).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'commit color' }));
      expect(trackCalls()).toEqual([
        [window.parent, { type: 'TRACK_EVENT', kind: 'click', eid: 'devtools.toolbar.text_color', properties: undefined }],
      ]);
    });

    it('updates element style.color on commit', () => {
      const paragraph = makeParagraph();
      renderTextColorButton(paragraph);
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      fireEvent.click(screen.getByRole('button', { name: 'commit color' }));
      expect(paragraph.style.color).toBe('rgb(255, 0, 0)');
    });

    it('posts UPDATED with property "color" and the committed hex value', () => {
      const paragraph = makeParagraph();
      renderTextColorButton(paragraph);
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      fireEvent.click(screen.getByRole('button', { name: 'commit color' }));
      expect(safePostMessage).toHaveBeenCalledWith(
        window.parent,
        expect.objectContaining({
          type: StyleMessageEventType.UPDATED,
          data: expect.objectContaining({
            property: 'color',
            value: '#ff0000',
          }),
        }),
      );
    });

    it('registers a style edit listener for rollback', () => {
      const paragraph = makeParagraph();
      renderTextColorButton(paragraph);
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      fireEvent.click(screen.getByRole('button', { name: 'commit color' }));
      expect(addStyleEditListener).toHaveBeenCalledOnce();
    });

    it('does not post when selectedElement is null', () => {
      renderTextColorButton(null);
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      fireEvent.click(screen.getByRole('button', { name: 'commit color' }));
      expect(safePostMessage).not.toHaveBeenCalled();
    });
  });

  describe('rollback on EDIT_FAILED', () => {
    it('restores style.color to the original value when EDIT_FAILED is received', () => {
      let capturedHandler: ((event: MessageEvent) => void) | null = null;
      vi.mocked(addStyleEditListener).mockImplementationOnce((handler) => {
        capturedHandler = handler;
        return 'mock-commit-id';
      });

      const paragraph = makeParagraph();
      paragraph.style.color = 'rgb(0, 128, 0)';

      renderTextColorButton(paragraph);
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      fireEvent.click(screen.getByRole('button', { name: 'commit color' }));

      expect(paragraph.style.color).toBe('rgb(255, 0, 0)');

      capturedHandler!({ data: { type: StyleMessageEventType.EDIT_FAILED } } as MessageEvent);

      expect(paragraph.style.color).toBe('rgb(0, 128, 0)');
    });
  });

  describe('transition management', () => {
    it('injects color transition on open and restores it on close', () => {
      const paragraph = makeParagraph();
      paragraph.style.transition = 'opacity 300ms';

      renderTextColorButton(paragraph);

      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      expect(paragraph.style.transition).toBe('color 200ms ease');

      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      expect(paragraph.style.transition).toBe('opacity 300ms');
    });
  });

  describe('cleanup on element change', () => {
    it('restores transition of the previous element when selectedElement changes', () => {
      const paragraphA = makeParagraph();
      paragraphA.style.transition = 'opacity 300ms';

      const paragraphB = makeParagraph();

      const { rerender } = renderTextColorButton(paragraphA);
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      expect(paragraphA.style.transition).toBe('color 200ms ease');

      rerender(reactCreateElement(ControlledTextColorButton, { selectedElement: paragraphB }));
      expect(paragraphA.style.transition).toBe('opacity 300ms');
    });

    it('does not apply stale lastCommittedColor from a prior session to a new element', () => {
      // Three-element scenario: A commits → switch to B (no picker opened) → switch to C.
      // The B→C switch triggers B's cleanup with a potentially stale lastCommittedColorRef
      // still holding A's committed color. B must not be touched.
      const paragraphA = makeParagraph();
      const paragraphB = makeParagraph();
      const paragraphC = makeParagraph();

      // Give B a distinct initial color so the assertion is non-trivial.
      paragraphB.style.color = 'rgb(0, 0, 255)';

      const { rerender } = renderTextColorButton(paragraphA);

      // Open picker for A and commit — lastCommittedColorRef becomes '#ff0000'.
      fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
      fireEvent.click(screen.getByRole('button', { name: 'commit color' }));

      // A→B: cleanup for A fires and must clear lastCommittedColorRef.
      rerender(reactCreateElement(ControlledTextColorButton, { selectedElement: paragraphB }));

      // B→C: cleanup for B fires — would stamp A's '#ff0000' onto B if ref wasn't cleared.
      rerender(reactCreateElement(ControlledTextColorButton, { selectedElement: paragraphC }));

      expect(paragraphB.style.color).toBe('rgb(0, 0, 255)');
    });
  });

  describe('popoverPlacement', () => {
    it('positions the color picker above when popoverPlacement is "above"', () => {
      const paragraph = makeParagraph();
      render(reactCreateElement(TextColorButton, {
        selectedElement: paragraph,
        isOpen: true,
        onOpenChange: vi.fn(),
        popoverPlacement: 'above',
      }));
      const pickerWrapper = screen.getByTestId('color-picker').parentElement!;
      expect(pickerWrapper.style.bottom).toBe('calc(100% + 4px)');
      expect(pickerWrapper.style.top).toBe('');
    });

    it('positions the color picker below when popoverPlacement is "below"', () => {
      const paragraph = makeParagraph();
      render(reactCreateElement(TextColorButton, {
        selectedElement: paragraph,
        isOpen: true,
        onOpenChange: vi.fn(),
        popoverPlacement: 'below',
      }));
      const pickerWrapper = screen.getByTestId('color-picker').parentElement!;
      expect(pickerWrapper.style.top).toBe('calc(100% + 4px)');
      expect(pickerWrapper.style.bottom).toBe('');
    });

    it('defaults to below when popoverPlacement is not provided', () => {
      const paragraph = makeParagraph();
      render(reactCreateElement(TextColorButton, {
        selectedElement: paragraph,
        isOpen: true,
        onOpenChange: vi.fn(),
      }));
      const pickerWrapper = screen.getByTestId('color-picker').parentElement!;
      expect(pickerWrapper.style.top).toBe('calc(100% + 4px)');
    });
  });
});

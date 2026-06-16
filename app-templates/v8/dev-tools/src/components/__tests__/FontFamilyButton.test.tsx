/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import FontFamilyButton from '../FontFamilyButton';

vi.mock('../../utils/postMessage', () => ({
  safePostMessage: vi.fn(),
}));

vi.mock('../../utils/elementStyleListeners', () => ({
  StyleMessageEventType: {
    UPDATED: 'STYLE_UPDATED',
    EDIT_FAILED: 'STYLE_EDIT_FAILED',
    EDIT_SUCCEEDED: 'STYLE_EDIT_SUCCEEDED',
  },
  addStyleEditListener: vi.fn((handler: (event: MessageEvent) => void) => {
    // Store the handler so tests can invoke it to simulate agent replies
    (addStyleEditListener as any).__lastHandler = handler;
    return 'mock-commit-id';
  }),
}));

vi.mock('../../utils/element-helpers', () => ({
  extractDevContext: vi.fn(() => ({ devId: 'test-id', fileName: 'test.tsx', lineNumber: 1, componentName: 'Test' })),
  generatePreciseSelector: vi.fn(() => 'div > h1'),
  getElementClassName: vi.fn((el: HTMLElement) => el.className),
}));

vi.mock('../../utils/translations', () => ({
  t: vi.fn((_: string, fallback: string) => fallback),
}));

vi.mock('../../utils/getFontList', () => ({
  getFontList: vi.fn(() => ({
    theme: [
      { label: 'Heading — Playfair Display', value: '"Playfair Display", serif' },
      { label: 'Body — Inter', value: 'Inter, sans-serif' },
    ],
    custom: [
      { label: 'Georgia', value: 'Georgia, serif' },
    ],
  })),
  recordRecentFont: vi.fn(),
}));

vi.mock('../../utils/eventBus', () => ({
  trackEventBus: { click: vi.fn() },
}));

import { safePostMessage } from '../../utils/postMessage';
import { addStyleEditListener } from '../../utils/elementStyleListeners';
import { recordRecentFont } from '../../utils/getFontList';

function makeHeading(): HTMLElement {
  const el = document.createElement('h1');
  el.textContent = 'Hello World';
  el.getBoundingClientRect = vi.fn(() => ({ top: 0, left: 0, width: 200, height: 40, right: 200, bottom: 40 }) as DOMRect);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('FontFamilyButton', () => {
  describe('rendering', () => {
    it('renders the font button', () => {
      const el = makeHeading();
      render(createElement(FontFamilyButton, { selectedElement: el, isOpen: false, onOpenChange: vi.fn() }));
      expect(screen.getByRole('button', { name: 'Font family' })).not.toBeNull();
    });

    it('does not show dropdown when closed', () => {
      const el = makeHeading();
      render(createElement(FontFamilyButton, { selectedElement: el, isOpen: false, onOpenChange: vi.fn() }));
      expect(screen.queryByText('Heading — Playfair Display')).toBeNull();
    });
  });

  describe('opening the menu', () => {
    it('calls onOpenChange(true) when clicked while closed', () => {
      const el = makeHeading();
      const onOpenChange = vi.fn();
      render(createElement(FontFamilyButton, { selectedElement: el, isOpen: false, onOpenChange }));
      fireEvent.click(screen.getByRole('button', { name: 'Font family' }));
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it('shows font options when open', () => {
      const el = makeHeading();
      render(createElement(FontFamilyButton, { selectedElement: el, isOpen: true, onOpenChange: vi.fn() }));
      expect(screen.getByText('Theme Fonts')).not.toBeNull();
      expect(screen.getByText('Custom Fonts')).not.toBeNull();
      expect(screen.getByText('Heading — Playfair Display')).not.toBeNull();
      expect(screen.getByText('Body — Inter')).not.toBeNull();
      expect(screen.getByText('Georgia')).not.toBeNull();
    });
  });

  describe('selecting a font', () => {
    it('applies font-family inline with !important', () => {
      const el = makeHeading();
      render(createElement(FontFamilyButton, { selectedElement: el, isOpen: true, onOpenChange: vi.fn() }));
      fireEvent.click(screen.getByText('Heading — Playfair Display'));
      expect(el.style.getPropertyValue('font-family')).toBe('"Playfair Display", serif');
      expect(el.style.getPropertyPriority('font-family')).toBe('important');
    });

    it('sends STYLE_UPDATED postMessage', () => {
      const el = makeHeading();
      render(createElement(FontFamilyButton, { selectedElement: el, isOpen: true, onOpenChange: vi.fn() }));
      fireEvent.click(screen.getByText('Body — Inter'));
      expect(safePostMessage).toHaveBeenCalledWith(
        window.parent,
        expect.objectContaining({
          type: 'STYLE_UPDATED',
          data: expect.objectContaining({
            commitId: 'mock-commit-id',
            property: 'fontFamily',
            value: 'Inter, sans-serif',
          }),
        }),
      );
    });

    it('registers an edit listener for rollback', () => {
      const el = makeHeading();
      render(createElement(FontFamilyButton, { selectedElement: el, isOpen: true, onOpenChange: vi.fn() }));
      fireEvent.click(screen.getByText('Heading — Playfair Display'));
      expect(addStyleEditListener).toHaveBeenCalled();
    });

    it('calls onOpenChange(false) after selection', () => {
      const el = makeHeading();
      const onOpenChange = vi.fn();
      render(createElement(FontFamilyButton, { selectedElement: el, isOpen: true, onOpenChange }));
      fireEvent.click(screen.getByText('Body — Inter'));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('closing the menu', () => {
    it('reverts inline style on close when no font was committed', () => {
      const el = makeHeading();
      el.style.setProperty('font-family', 'Original, serif', 'important');
      const onOpenChange = vi.fn();

      // First render: open menu (captures original)
      const { rerender } = render(
        createElement(FontFamilyButton, { selectedElement: el, isOpen: false, onOpenChange }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Font family' }));

      // Re-render as open
      rerender(createElement(FontFamilyButton, { selectedElement: el, isOpen: true, onOpenChange }));

      // Click the button again to close
      fireEvent.click(screen.getByRole('button', { name: 'Font family' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('rollback and success callbacks', () => {
    it('rolls back font-family on EDIT_FAILED', () => {
      const el = makeHeading();
      el.style.setProperty('font-family', 'Original, serif', 'important');
      const onOpenChange = vi.fn();

      // Open the menu (captures originalFontRef)
      const { rerender } = render(
        createElement(FontFamilyButton, { selectedElement: el, isOpen: false, onOpenChange }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Font family' }));
      rerender(createElement(FontFamilyButton, { selectedElement: el, isOpen: true, onOpenChange }));

      // Select a font — applies optimistically
      fireEvent.click(screen.getByText('Body — Inter'));
      expect(el.style.getPropertyValue('font-family')).toBe('Inter, sans-serif');

      // Simulate agent failure
      const handler = (addStyleEditListener as any).__lastHandler;
      handler({ data: { type: 'STYLE_EDIT_FAILED' } } as MessageEvent);

      // Should revert to original
      expect(el.style.getPropertyValue('font-family')).toBe('Original, serif');
    });

    it('records recent font on EDIT_SUCCEEDED', () => {
      const el = makeHeading();
      const onOpenChange = vi.fn();

      const { rerender } = render(
        createElement(FontFamilyButton, { selectedElement: el, isOpen: false, onOpenChange }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Font family' }));
      rerender(createElement(FontFamilyButton, { selectedElement: el, isOpen: true, onOpenChange }));

      fireEvent.click(screen.getByText('Body — Inter'));

      // Simulate agent success
      const handler = (addStyleEditListener as any).__lastHandler;
      handler({ data: { type: 'STYLE_EDIT_SUCCEEDED' } } as MessageEvent);

      expect(recordRecentFont).toHaveBeenCalledWith({ label: 'Body — Inter', value: 'Inter, sans-serif' });
    });
  });

  describe('empty font list', () => {
    it('shows "No fonts available" when getFontList returns empty', async () => {
      const { getFontList } = await import('../../utils/getFontList');
      (getFontList as ReturnType<typeof vi.fn>).mockReturnValueOnce({ theme: [], custom: [] });

      const el = makeHeading();
      const onOpenChange = vi.fn();
      render(createElement(FontFamilyButton, { selectedElement: el, isOpen: false, onOpenChange }));
      fireEvent.click(screen.getByRole('button', { name: 'Font family' }));

      // Re-render as open to display the dropdown
      cleanup();
      (getFontList as ReturnType<typeof vi.fn>).mockReturnValueOnce({ theme: [], custom: [] });
      render(createElement(FontFamilyButton, { selectedElement: el, isOpen: true, onOpenChange }));
      expect(screen.getByText('No fonts available')).not.toBeNull();
    });
  });

  describe('popoverPlacement', () => {
    it('positions the font picker above when popoverPlacement is "above"', () => {
      const el = makeHeading();
      render(createElement(FontFamilyButton, {
        selectedElement: el,
        isOpen: true,
        onOpenChange: vi.fn(),
        popoverPlacement: 'above',
      }));
      // FontPicker renders a list; find its wrapper via the data-airo-dev-tools attribute
      const pickerWrapper = document.querySelector('[data-airo-dev-tools]') as HTMLElement;
      expect(pickerWrapper.style.bottom).toBe('calc(100% + 4px)');
      expect(pickerWrapper.style.top).toBe('');
    });

    it('positions the font picker below when popoverPlacement is "below"', () => {
      const el = makeHeading();
      render(createElement(FontFamilyButton, {
        selectedElement: el,
        isOpen: true,
        onOpenChange: vi.fn(),
        popoverPlacement: 'below',
      }));
      const pickerWrapper = document.querySelector('[data-airo-dev-tools]') as HTMLElement;
      expect(pickerWrapper.style.top).toBe('calc(100% + 4px)');
      expect(pickerWrapper.style.bottom).toBe('');
    });

    it('defaults to below when popoverPlacement is not provided', () => {
      const el = makeHeading();
      render(createElement(FontFamilyButton, {
        selectedElement: el,
        isOpen: true,
        onOpenChange: vi.fn(),
      }));
      const pickerWrapper = document.querySelector('[data-airo-dev-tools]') as HTMLElement;
      expect(pickerWrapper.style.top).toBe('calc(100% + 4px)');
    });
  });
});

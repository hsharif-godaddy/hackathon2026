/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import BoldButton from '../BoldButton';

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
  t: vi.fn((_: string, fallback: string) => fallback),
}));

vi.mock('../../utils/text-editing-helpers', () => ({
  ensureBoldFontLoaded: vi.fn(),
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

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('BoldButton', () => {
  describe('rendering', () => {
    it('renders the toolbar button', () => {
      const paragraph = makeParagraph();
      render(createElement(BoldButton, { selectedElement: paragraph }));
      expect(screen.getByRole('button', { name: 'Toggle bold' })).not.toBeNull();
    });

    it('renders with null selectedElement without crashing', () => {
      const { container } = render(createElement(BoldButton, { selectedElement: null }));
      expect(container.firstChild).not.toBeNull();
    });

    it('is not active when element has no font-bold class', () => {
      const paragraph = makeParagraph('text-center');
      render(createElement(BoldButton, { selectedElement: paragraph }));
      const btn = screen.getByRole('button', { name: 'Toggle bold' });
      expect(btn.style.color).toBe('var(--color-text-secondary)');
    });

    it('is active when element has font-bold class', () => {
      const paragraph = makeParagraph('font-bold text-center');
      render(createElement(BoldButton, { selectedElement: paragraph }));
      const btn = screen.getByRole('button', { name: 'Toggle bold' });
      expect(btn.style.color).toBe('rgb(37, 99, 235)');
    });
  });

  describe('toggle bold', () => {
    it('adds font-bold class when element is not bold', () => {
      const paragraph = makeParagraph();
      render(createElement(BoldButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle bold' }));
      expect(paragraph.classList.contains('font-bold')).toBe(true);
    });

    it('removes font-bold class when element is already bold', () => {
      const paragraph = makeParagraph('font-bold text-center');
      render(createElement(BoldButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle bold' }));
      expect(paragraph.classList.contains('font-bold')).toBe(false);
    });

    it('preserves other classes when toggling bold on', () => {
      const paragraph = makeParagraph('text-center italic');
      render(createElement(BoldButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle bold' }));
      expect(paragraph.classList.contains('text-center')).toBe(true);
      expect(paragraph.classList.contains('italic')).toBe(true);
      expect(paragraph.classList.contains('font-bold')).toBe(true);
    });

    it('does nothing when selectedElement is null', () => {
      render(createElement(BoldButton, { selectedElement: null }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle bold' }));
      expect(safePostMessage).not.toHaveBeenCalled();
    });
  });

  describe('postMessage', () => {
    it('posts UPDATED with fontWeight bold when adding bold', () => {
      const paragraph = makeParagraph();
      render(createElement(BoldButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle bold' }));
      expect(safePostMessage).toHaveBeenCalledWith(
        window.parent,
        expect.objectContaining({
          type: StyleMessageEventType.UPDATED,
          data: expect.objectContaining({
            property: 'fontWeight',
            value: 'bold',
          }),
        }),
      );
    });

    it('posts UPDATED with fontWeight normal when removing bold', () => {
      const paragraph = makeParagraph('font-bold');
      render(createElement(BoldButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle bold' }));
      expect(safePostMessage).toHaveBeenCalledWith(
        window.parent,
        expect.objectContaining({
          data: expect.objectContaining({
            property: 'fontWeight',
            value: 'normal',
          }),
        }),
      );
    });

    it('fires devtools.toolbar.bold click track event', () => {
      const paragraph = makeParagraph();
      render(createElement(BoldButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle bold' }));
      expect(safePostMessage).toHaveBeenCalledWith(window.parent, {
        type: 'TRACK_EVENT',
        kind: 'click',
        eid: 'devtools.toolbar.bold',
        properties: undefined,
      });
    });

    it('registers a style edit listener for rollback', () => {
      const paragraph = makeParagraph();
      render(createElement(BoldButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle bold' }));
      expect(addStyleEditListener).toHaveBeenCalledOnce();
    });
  });

  describe('rollback on EDIT_FAILED', () => {
    it('restores the original className when EDIT_FAILED is received', () => {
      let capturedHandler: ((event: MessageEvent) => void) | null = null;
      vi.mocked(addStyleEditListener).mockImplementationOnce((handler) => {
        capturedHandler = handler;
        return 'mock-commit-id';
      });

      const paragraph = makeParagraph('text-center');
      render(createElement(BoldButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle bold' }));

      expect(paragraph.classList.contains('font-bold')).toBe(true);

      capturedHandler!({ data: { type: StyleMessageEventType.EDIT_FAILED } } as MessageEvent);

      expect(paragraph.className).toBe('text-center');
    });
  });
});

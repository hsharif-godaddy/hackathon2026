/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import ItalicButton from '../ItalicButton';

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

describe('ItalicButton', () => {
  describe('rendering', () => {
    it('renders the toolbar button', () => {
      const paragraph = makeParagraph();
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      expect(screen.getByRole('button', { name: 'Toggle italic' })).not.toBeNull();
    });

    it('renders with null selectedElement without crashing', () => {
      const { container } = render(createElement(ItalicButton, { selectedElement: null }));
      expect(container.firstChild).not.toBeNull();
    });

    it('is not active when element has no italic class', () => {
      const paragraph = makeParagraph('text-center');
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      const btn = screen.getByRole('button', { name: 'Toggle italic' });
      expect(btn.style.color).toBe('var(--color-text-secondary)');
    });

    it('is active when element has italic class', () => {
      const paragraph = makeParagraph('italic text-center');
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      const btn = screen.getByRole('button', { name: 'Toggle italic' });
      expect(btn.style.color).toBe('rgb(37, 99, 235)');
    });
  });

  describe('toggle italic', () => {
    it('adds italic class when element is not italic', () => {
      const paragraph = makeParagraph();
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle italic' }));
      expect(paragraph.classList.contains('italic')).toBe(true);
    });

    it('removes italic class when element is already italic', () => {
      const paragraph = makeParagraph('italic text-center');
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle italic' }));
      expect(paragraph.classList.contains('italic')).toBe(false);
    });

    it('preserves other classes when toggling italic on', () => {
      const paragraph = makeParagraph('text-center font-bold');
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle italic' }));
      expect(paragraph.classList.contains('text-center')).toBe(true);
      expect(paragraph.classList.contains('font-bold')).toBe(true);
      expect(paragraph.classList.contains('italic')).toBe(true);
    });

    it('does nothing when selectedElement is null', () => {
      render(createElement(ItalicButton, { selectedElement: null }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle italic' }));
      expect(safePostMessage).not.toHaveBeenCalled();
    });
  });

  describe('tracking', () => {
    it('fires devtools.toolbar.italic click track event', () => {
      const paragraph = makeParagraph();
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle italic' }));
      expect(safePostMessage).toHaveBeenCalledWith(window.parent, {
        type: 'TRACK_EVENT',
        kind: 'click',
        eid: 'devtools.toolbar.italic',
        properties: undefined,
      });
    });
  });

  describe('postMessage', () => {
    it('posts UPDATED with fontStyle italic when adding italic', () => {
      const paragraph = makeParagraph();
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle italic' }));
      expect(safePostMessage).toHaveBeenCalledWith(
        window.parent,
        expect.objectContaining({
          type: StyleMessageEventType.UPDATED,
          data: expect.objectContaining({
            property: 'fontStyle',
            value: 'italic',
          }),
        }),
      );
    });

    it('posts UPDATED with fontStyle normal when removing italic', () => {
      const paragraph = makeParagraph('italic');
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle italic' }));
      expect(safePostMessage).toHaveBeenCalledWith(
        window.parent,
        expect.objectContaining({
          data: expect.objectContaining({
            property: 'fontStyle',
            value: 'normal',
          }),
        }),
      );
    });

    it('registers a style edit listener for rollback', () => {
      const paragraph = makeParagraph();
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle italic' }));
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
      render(createElement(ItalicButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle italic' }));

      expect(paragraph.classList.contains('italic')).toBe(true);

      capturedHandler!({ data: { type: StyleMessageEventType.EDIT_FAILED } } as MessageEvent);

      expect(paragraph.className).toBe('text-center');
    });
  });
});

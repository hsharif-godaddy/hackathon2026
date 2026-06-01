/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import TextAlignButton from '../TextAlignButton';

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

describe('TextAlignButton', () => {
  describe('rendering', () => {
    it('renders the toolbar button', () => {
      const paragraph = makeParagraph();
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      expect(screen.getByRole('button', { name: 'Text alignment' })).not.toBeNull();
    });

    it('does not show the dropdown by default', () => {
      const paragraph = makeParagraph();
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      expect(screen.queryByRole('button', { name: 'Align center' })).toBeNull();
    });

    it('renders with null selectedElement without crashing', () => {
      const { container } = render(createElement(TextAlignButton, { selectedElement: null }));
      expect(container.firstChild).not.toBeNull();
    });
  });

  describe('menu toggle', () => {
    it('opens the dropdown when the toolbar button is clicked', () => {
      const paragraph = makeParagraph();
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      expect(screen.getByRole('button', { name: 'Align left' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Align center' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Align right' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Align justify' })).not.toBeNull();
    });

    it('closes the dropdown when the toolbar button is clicked again', () => {
      const paragraph = makeParagraph();
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      expect(screen.queryByRole('button', { name: 'Align center' })).toBeNull();
    });
  });

  describe('tracking', () => {
    it('fires devtools.toolbar.text_align click on apply (not on toolbar open)', () => {
      const paragraph = makeParagraph();
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      const trackCalls = () =>
        vi.mocked(safePostMessage).mock.calls.filter(
          ([, msg]) => (msg as { type?: string })?.type === 'TRACK_EVENT',
        );
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      expect(trackCalls()).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Align center' }));
      expect(trackCalls()).toEqual([
        [window.parent, { type: 'TRACK_EVENT', kind: 'click', eid: 'devtools.toolbar.text_align', properties: undefined }],
      ]);
    });
  });

  describe('alignment selection', () => {
    it('adds the alignment class to the element', () => {
      const paragraph = makeParagraph();
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Align center' }));
      expect(paragraph.classList.contains('text-center')).toBe(true);
    });

    it('removes other alignment classes when applying a new one', () => {
      const paragraph = makeParagraph('text-left font-bold');
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Align right' }));
      expect(paragraph.classList.contains('text-right')).toBe(true);
      expect(paragraph.classList.contains('text-left')).toBe(false);
    });

    it('removes the alignment class when clicking the active alignment (toggle off)', () => {
      const paragraph = makeParagraph('text-center');
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Align center' }));
      expect(paragraph.classList.contains('text-center')).toBe(false);
    });

    it('closes the dropdown after selecting an alignment', () => {
      const paragraph = makeParagraph();
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Align left' }));
      expect(screen.queryByRole('button', { name: 'Align center' })).toBeNull();
    });

    it('supports text-justify', () => {
      const paragraph = makeParagraph();
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Align justify' }));
      expect(paragraph.classList.contains('text-justify')).toBe(true);
    });
  });

  describe('postMessage', () => {
    it('posts UPDATED with the new alignment value', () => {
      const paragraph = makeParagraph();
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Align center' }));
      expect(safePostMessage).toHaveBeenCalledWith(
        window.parent,
        expect.objectContaining({
          type: StyleMessageEventType.UPDATED,
          data: expect.objectContaining({
            property: 'textAlign',
            value: 'center',
          }),
        }),
      );
    });

    it('posts UPDATED with empty value when toggling alignment off', () => {
      const paragraph = makeParagraph('text-right');
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Align right' }));
      expect(safePostMessage).toHaveBeenCalledWith(
        window.parent,
        expect.objectContaining({
          data: expect.objectContaining({ value: '' }),
        }),
      );
    });

    it('does not post when selectedElement is null', () => {
      render(createElement(TextAlignButton, { selectedElement: null }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      expect(safePostMessage).not.toHaveBeenCalled();
    });

    it('registers a style edit listener for rollback', () => {
      const paragraph = makeParagraph();
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Align left' }));
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

      const paragraph = makeParagraph('font-bold');
      render(createElement(TextAlignButton, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text alignment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Align center' }));

      expect(paragraph.classList.contains('text-center')).toBe(true);

      capturedHandler!({ data: { type: StyleMessageEventType.EDIT_FAILED } } as MessageEvent);

      expect(paragraph.className).toBe('font-bold');
    });
  });
});

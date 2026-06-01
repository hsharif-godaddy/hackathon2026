/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement, useState } from 'react';
import ListTypeButton from '../ListTypeButton';

function Controlled({ selectedElement }: { selectedElement: HTMLElement | null }) {
  const [isOpen, setIsOpen] = useState(false);
  return createElement(ListTypeButton, { selectedElement, isOpen, onOpenChange: setIsOpen });
}

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
  generatePreciseSelector: vi.fn(() => 'div > ul'),
  getElementClassName: vi.fn((el: HTMLElement) => el.className),
}));

vi.mock('../../utils/translations', () => ({
  t: vi.fn((_: string, fallback: string) => fallback),
}));

import { safePostMessage } from '../../utils/postMessage';
import { addStyleEditListener, StyleMessageEventType } from '../../utils/elementStyleListeners';

function makeList(tag: 'ul' | 'ol' = 'ul', className = ''): HTMLElement {
  const list = document.createElement(tag);
  list.className = className;
  list.getBoundingClientRect = vi.fn(() => ({ top: 0, left: 0, width: 100, height: 60, right: 100, bottom: 60 } as DOMRect));
  document.body.appendChild(list);
  return list;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('ListTypeButton', () => {
  describe('rendering', () => {
    it('renders the toolbar button', () => {
      const list = makeList();
      render(createElement(Controlled, { selectedElement: list }));
      expect(screen.getByRole('button', { name: 'List type' })).not.toBeNull();
    });

    it('does not show the dropdown by default', () => {
      const list = makeList();
      render(createElement(Controlled, { selectedElement: list }));
      expect(screen.queryByRole('button', { name: 'List disc' })).toBeNull();
    });

    it('renders with null selectedElement without crashing', () => {
      const { container } = render(createElement(Controlled, { selectedElement: null }));
      expect(container.firstChild).not.toBeNull();
    });
  });

  describe('menu toggle', () => {
    it('opens the dropdown when the toolbar button is clicked', () => {
      const list = makeList();
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      expect(screen.getByRole('button', { name: 'List disc' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'List decimal' })).not.toBeNull();
    });

    it('closes the dropdown when the toolbar button is clicked again', () => {
      const list = makeList();
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      expect(screen.queryByRole('button', { name: 'List disc' })).toBeNull();
    });
  });

  describe('tracking', () => {
    it('fires devtools.toolbar.list_type click on apply (not on toolbar open)', () => {
      const list = makeList();
      render(createElement(Controlled, { selectedElement: list }));
      const trackCalls = () =>
        vi.mocked(safePostMessage).mock.calls.filter(
          ([, msg]) => (msg as { type?: string })?.type === 'TRACK_EVENT',
        );
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      expect(trackCalls()).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'List disc' }));
      expect(trackCalls()).toEqual([
        [window.parent, { type: 'TRACK_EVENT', kind: 'click', eid: 'devtools.toolbar.list_type', properties: undefined }],
      ]);
    });
  });

  describe('list type selection', () => {
    it('adds list-disc and [&>*]:list-item when selecting disc', () => {
      const list = makeList();
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List disc' }));
      expect(list.classList.contains('list-disc')).toBe(true);
      expect(list.classList.contains('[&>*]:list-item')).toBe(true);
    });

    it('adds list-decimal and [&>*]:list-item when selecting decimal', () => {
      const list = makeList();
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List decimal' }));
      expect(list.classList.contains('list-decimal')).toBe(true);
      expect(list.classList.contains('[&>*]:list-item')).toBe(true);
    });

    it('replaces list-disc with list-decimal when switching types', () => {
      const list = makeList('ul', 'list-disc [&>*]:list-item');
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List decimal' }));
      expect(list.classList.contains('list-decimal')).toBe(true);
      expect(list.classList.contains('list-disc')).toBe(false);
    });

    it('removes list type and [&>*]:list-item when clicking the active type (toggle off)', () => {
      const list = makeList('ul', 'list-disc [&>*]:list-item');
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List disc' }));
      expect(list.classList.contains('list-disc')).toBe(false);
      expect(list.classList.contains('[&>*]:list-item')).toBe(false);
    });

    it('closes the dropdown after selecting a list type', () => {
      const list = makeList();
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List disc' }));
      expect(screen.queryByRole('button', { name: 'List decimal' })).toBeNull();
    });

    it('preserves unrelated classes when changing list type', () => {
      const list = makeList('ul', 'font-bold text-center');
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List disc' }));
      expect(list.classList.contains('font-bold')).toBe(true);
      expect(list.classList.contains('text-center')).toBe(true);
    });
  });

  describe('postMessage', () => {
    it('posts UPDATED with listStyleType disc when selecting disc', () => {
      const list = makeList();
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List disc' }));
      expect(safePostMessage).toHaveBeenCalledWith(
        window.parent,
        expect.objectContaining({
          type: StyleMessageEventType.UPDATED,
          data: expect.objectContaining({
            property: 'listStyleType',
            value: 'disc',
          }),
        }),
      );
    });

    it('posts UPDATED with empty value when toggling list type off', () => {
      const list = makeList('ul', 'list-decimal [&>*]:list-item');
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List decimal' }));
      expect(safePostMessage).toHaveBeenCalledWith(
        window.parent,
        expect.objectContaining({
          data: expect.objectContaining({
            property: 'listStyleType',
            value: '',
          }),
        }),
      );
    });

    it('does not post when selectedElement is null', () => {
      render(createElement(Controlled, { selectedElement: null }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      expect(safePostMessage).not.toHaveBeenCalled();
    });

    it('registers a style edit listener for rollback', () => {
      const list = makeList();
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List disc' }));
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

      const list = makeList('ul', 'font-bold');
      render(createElement(Controlled, { selectedElement: list }));
      fireEvent.click(screen.getByRole('button', { name: 'List type' }));
      fireEvent.click(screen.getByRole('button', { name: 'List disc' }));

      expect(list.classList.contains('list-disc')).toBe(true);

      capturedHandler!({ data: { type: StyleMessageEventType.EDIT_FAILED } } as MessageEvent);

      expect(list.className).toBe('font-bold');
    });
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement, useState } from 'react';
import TextSizeStepperButton from '../TextSizeStepperButton';

function Controlled({ selectedElement }: { selectedElement: HTMLElement | null }) {
  const [isOpen, setIsOpen] = useState(false);
  return createElement(TextSizeStepperButton, { selectedElement, isOpen, onOpenChange: setIsOpen });
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
  generatePreciseSelector: vi.fn(() => 'div > p'),
  getElementClassName: vi.fn((el: HTMLElement) => el.className),
}));

vi.mock('../../utils/translations', () => ({
  t: vi.fn((_: string, fallback: string) => fallback),
}));

import { safePostMessage } from '../../utils/postMessage';

function makeParagraph(className = ''): HTMLElement {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.getBoundingClientRect = vi.fn(() => ({ top: 0, left: 0, width: 100, height: 20, right: 100, bottom: 20 } as DOMRect));
  document.body.appendChild(paragraph);
  return paragraph;
}

const trackCalls = () =>
  vi.mocked(safePostMessage).mock.calls.filter(
    ([, msg]) => (msg as { type?: string })?.type === 'TRACK_EVENT',
  );

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = '';
  // Default computed font-size so nearestSizeClass picks "text-base", leaving up/down both available.
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () => ({ fontSize: '16px' } as unknown as CSSStyleDeclaration),
  );
});

describe('TextSizeStepperButton', () => {
  describe('tracking', () => {
    it('fires devtools.toolbar.text_size_up click on increment', () => {
      const paragraph = makeParagraph('text-base');
      render(createElement(Controlled, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text size' }));
      fireEvent.click(screen.getByRole('button', { name: 'Increase text size' }));
      expect(trackCalls()).toEqual([
        [window.parent, { type: 'TRACK_EVENT', kind: 'click', eid: 'devtools.toolbar.text_size_up', properties: undefined }],
      ]);
    });

    it('fires devtools.toolbar.text_size_down click on decrement', () => {
      const paragraph = makeParagraph('text-base');
      render(createElement(Controlled, { selectedElement: paragraph }));
      fireEvent.click(screen.getByRole('button', { name: 'Text size' }));
      fireEvent.click(screen.getByRole('button', { name: 'Decrease text size' }));
      expect(trackCalls()).toEqual([
        [window.parent, { type: 'TRACK_EVENT', kind: 'click', eid: 'devtools.toolbar.text_size_down', properties: undefined }],
      ]);
    });
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { createRef } from 'react';

import { useImageHoverDetection } from '../useImageHoverDetection';

type EditingState = { editingElement: HTMLElement | null; saveStatus?: string };

function makeEditingRef(saveStatus: string = 'idle') {
  const ref = createRef<EditingState>() as { current: EditingState };
  ref.current = { editingElement: null, saveStatus };
  return ref;
}

function fireClick(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function fireMouseOver(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
}

describe('useImageHoverDetection hover path', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('shows outline target on hover without opening the toolbar', () => {
    const h1 = document.createElement('h1');
    h1.textContent = 'Hello';
    document.body.appendChild(h1);

    const editingRef = makeEditingRef();
    const { result } = renderHook(() => useImageHoverDetection(true, editingRef));

    fireMouseOver(h1);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.hoveredElement?.element).toBe(h1);
    expect(result.current.toolbarMode).toBe(false);
  });
});

describe('useImageHoverDetection click path', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('resolves a click on a <span> inside an <h1> to the <h1>', () => {
    const h1 = document.createElement('h1');
    h1.appendChild(document.createTextNode('Hello '));
    const span = document.createElement('span');
    span.textContent = 'world';
    h1.appendChild(span);
    document.body.appendChild(h1);

    const editingRef = makeEditingRef();
    const { result } = renderHook(() => useImageHoverDetection(true, editingRef));

    fireClick(span);

    expect(result.current.hoveredElement?.type).toBe('content');
    expect(result.current.hoveredElement?.element).toBe(h1);
    expect(result.current.toolbarMode).toBe(true);
  });

  it('opens the bar on a <p> that contains an <a>', () => {
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('Visit '));
    const a = document.createElement('a');
    a.href = '/x';
    a.textContent = 'link';
    p.appendChild(a);
    document.body.appendChild(p);

    const editingRef = makeEditingRef();
    const { result } = renderHook(() => useImageHoverDetection(true, editingRef));

    fireClick(p);

    expect(result.current.hoveredElement?.type).toBe('content');
    expect(result.current.hoveredElement?.element).toBe(p);
    expect(result.current.toolbarMode).toBe(true);
  });

  it('does not open the bar while saveStatus is "saving"', () => {
    const h1 = document.createElement('h1');
    h1.textContent = 'Saving in flight';
    document.body.appendChild(h1);

    const editingRef = makeEditingRef('saving');
    const { result } = renderHook(() => useImageHoverDetection(true, editingRef));

    fireClick(h1);

    expect(result.current.hoveredElement).toBeNull();
    expect(result.current.toolbarMode).toBe(false);
  });

  it('clears the pending hover commit when the mouse reaches the dev-tools bar', () => {
    vi.useFakeTimers();
    try {
      const h1 = document.createElement('h1');
      h1.textContent = 'Wildflowers';
      const p = document.createElement('p');
      p.textContent = 'Each arrangement is a one-of-a-kind creation.';
      const bar = document.createElement('div');
      bar.setAttribute('data-airo-dev-tools', '');
      bar.className = 'edit-mode-hover-bar';
      document.body.append(h1, p, bar);

      const editingRef = makeEditingRef();
      const { result } = renderHook(() => useImageHoverDetection(true, editingRef));

      act(() => {
        p.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(result.current.toolbarMode).toBe(true);
      expect(result.current.hoveredElement?.element).toBe(p);

      act(() => {
        h1.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      act(() => {
        bar.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.toolbarMode).toBe(true);
      expect(result.current.hoveredElement?.element).toBe(p);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not open the bar on a link inside a <nav>', () => {
    const nav = document.createElement('nav');
    const a = document.createElement('a');
    a.href = '/x';
    a.textContent = 'Home';
    nav.appendChild(a);
    document.body.appendChild(nav);

    const editingRef = makeEditingRef();
    const { result } = renderHook(() => useImageHoverDetection(true, editingRef));

    fireClick(a);

    expect(result.current.hoveredElement).toBeNull();
    expect(result.current.toolbarMode).toBe(false);
  });
});

describe('useImageHoverDetection toolbar dismiss', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps the toolbar open on in-document mouseout while toolbar is open', () => {
    const h1 = document.createElement('h1');
    h1.textContent = 'Title';
    const p = document.createElement('p');
    p.textContent = 'Body';
    document.body.append(h1, p);

    const editingRef = makeEditingRef();
    const { result } = renderHook(() => useImageHoverDetection(true, editingRef));

    fireClick(p);
    act(() => {
      p.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: h1 }));
    });

    expect(result.current.toolbarMode).toBe(true);
    expect(result.current.hoveredElement?.element).toBe(p);
  });

  it('dismisses the toolbar when the pointer leaves the document', () => {
    const p = document.createElement('p');
    p.textContent = 'Body';
    document.body.appendChild(p);

    const editingRef = makeEditingRef();
    const { result } = renderHook(() => useImageHoverDetection(true, editingRef));

    fireClick(p);
    act(() => {
      p.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }));
    });

    expect(result.current.toolbarMode).toBe(false);
    expect(result.current.hoveredElement).toBeNull();
  });

  it('dismisses the toolbar when the document becomes hidden', () => {
    const p = document.createElement('p');
    p.textContent = 'Body';
    document.body.appendChild(p);

    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    const editingRef = makeEditingRef();
    const { result } = renderHook(() => useImageHoverDetection(true, editingRef));

    fireClick(p);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.toolbarMode).toBe(false);
    expect(result.current.hoveredElement).toBeNull();

    visibilitySpy.mockRestore();
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

vi.mock('../utils/postMessage', () => ({
  safePostMessage: vi.fn(),
}));

vi.mock('../utils/element-helpers', () => ({
  extractDevContext: vi.fn(() => ({
    fileName: 'test.tsx',
    componentName: 'Test',
    lineNumber: 1,
  })),
  generatePreciseSelector: vi.fn(() => 'p'),
  getElementClassName: vi.fn((el: HTMLElement) => el.className),
}));

vi.mock('../utils/text-editing-helpers', () => ({
  mergeOriginalClasses: vi.fn((html: string) => html),
}));

vi.mock('../utils/html-to-jsx', () => ({
  htmlToJsxStructured: vi.fn(() => ({ childrenJsx: 'jsx-output', tagJsx: '<p>jsx-output</p>' })),
}));

import { useTextFix } from '../hooks/useTextFix';
import { safePostMessage } from '../utils/postMessage';

function makeParagraph(html: string): HTMLElement {
  // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
  const doc = new DOMParser().parseFromString(
    `<p class="text-lg">${html}</p>`,
    'text/html'
  );
  const p = doc.body.firstElementChild as HTMLElement;
  document.body.appendChild(p);
  return p;
}

/** Replays a parent-window postMessage reply for the most recent request. */
function replyFromParent(type: string, requestId: string, data?: unknown): void {
  const event = new MessageEvent('message', {
    data: { type, requestId, data },
    source: window.parent as MessageEventSource,
  });
  window.dispatchEvent(event);
}

function lastRequestId(): string {
  const calls = (safePostMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const last = calls[calls.length - 1] as [unknown, { data: { requestId: string } }];
  return last[1].data.requestId;
}

describe('useTextFix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useTextFix());
    expect(result.current.state.status).toBe('idle');
  });

  it('transitions to loading on request and posts TEXT_FIX_REQUESTED', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('teh quick fox');

    act(() => {
      result.current.request(el);
    });

    expect(result.current.state.status).toBe('loading');
    expect(safePostMessage).toHaveBeenCalledTimes(1);
    const [, payload] = (safePostMessage as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [unknown, { type: string; data: { oldText: string } }];
    expect(payload.type).toBe('TEXT_FIX_REQUESTED');
    expect(payload.data.oldText).toBe('teh quick fox');
  });

  it('skips request when element has no trimmed text content', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('   ');

    act(() => {
      result.current.request(el);
    });

    expect(result.current.state.status).toBe('idle');
    expect(safePostMessage).not.toHaveBeenCalled();
  });

  it('skips request for Commerce-managed product text', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('Commerce product');
    el.setAttribute('data-dev-source-origin', 'commerce');
    el.setAttribute('data-dev-commerce-product-id', 'sku-group-1');

    act(() => {
      result.current.request(el);
    });

    expect(result.current.state.status).toBe('idle');
    expect(safePostMessage).not.toHaveBeenCalled();
  });

  it('transitions to preview on TEXT_FIX_RESULT with changed:true and a real diff', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('teh quick fox');

    act(() => {
      result.current.request(el);
    });
    const requestId = lastRequestId();

    act(() => {
      replyFromParent('TEXT_FIX_RESULT', requestId, {
        newText: 'the quick fox',
        changed: true,
      });
    });

    expect(result.current.state.status).toBe('preview');
    if (result.current.state.status === 'preview') {
      expect(result.current.state.oldHtml).toBe('teh quick fox');
      expect(result.current.state.newHtml).toBe('the quick fox');
    }
  });

  it('transitions to no-change when the model returns the same text', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('hello world');

    act(() => {
      result.current.request(el);
    });
    const requestId = lastRequestId();

    act(() => {
      replyFromParent('TEXT_FIX_RESULT', requestId, {
        newText: 'hello world',
        changed: false,
      });
    });

    expect(result.current.state.status).toBe('no-change');
  });

  it('treats whitespace-only differences as no-change', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('hello  world');

    act(() => {
      result.current.request(el);
    });
    const requestId = lastRequestId();

    act(() => {
      replyFromParent('TEXT_FIX_RESULT', requestId, {
        newText: 'hello world',
        changed: true,
      });
    });

    expect(result.current.state.status).toBe('no-change');
  });

  it('transitions to error on TEXT_FIX_FAILED', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('teh quick fox');

    act(() => {
      result.current.request(el);
    });
    const requestId = lastRequestId();

    act(() => {
      replyFromParent('TEXT_FIX_FAILED', requestId);
    });

    expect(result.current.state.status).toBe('error');
  });

  it('ignores reply with mismatched requestId', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('teh quick fox');

    act(() => {
      result.current.request(el);
    });

    act(() => {
      replyFromParent('TEXT_FIX_RESULT', 'wrong-id', { newText: 'x', changed: true });
    });

    expect(result.current.state.status).toBe('loading');
  });

  it('reset() returns to idle', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('teh quick fox');

    act(() => {
      result.current.request(el);
    });
    expect(result.current.state.status).toBe('loading');

    act(() => {
      result.current.reset();
    });
    expect(result.current.state.status).toBe('idle');
  });

  it('reject() from preview returns to idle', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('teh');

    act(() => {
      result.current.request(el);
    });
    act(() => {
      replyFromParent('TEXT_FIX_RESULT', lastRequestId(), { newText: 'the', changed: true });
    });
    expect(result.current.state.status).toBe('preview');

    act(() => {
      result.current.reject();
    });
    expect(result.current.state.status).toBe('idle');
  });

  it('accept() emits TEXT_FIX_ACCEPTED + TEXT_UPDATED and returns to idle', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('teh');

    act(() => {
      result.current.request(el);
    });
    act(() => {
      replyFromParent('TEXT_FIX_RESULT', lastRequestId(), { newText: 'the', changed: true });
    });

    (safePostMessage as unknown as { mockClear: () => void }).mockClear();

    act(() => {
      result.current.accept(el);
    });

    expect(result.current.state.status).toBe('idle');
    const calls = (safePostMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const types = calls.map((c) => (c[1] as { type: string }).type);
    expect(types).toContain('TEXT_FIX_ACCEPTED');
    expect(types).toContain('TEXT_UPDATED');
  });

  it('accept() does not emit TEXT_UPDATED for Commerce-managed product text', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('teh');

    act(() => {
      result.current.request(el);
    });
    act(() => {
      replyFromParent('TEXT_FIX_RESULT', lastRequestId(), { newText: 'the', changed: true });
    });

    el.setAttribute('data-dev-source-origin', 'commerce');
    el.setAttribute('data-dev-commerce-product-id', 'sku-group-1');
    (safePostMessage as unknown as { mockClear: () => void }).mockClear();

    act(() => {
      result.current.accept(el);
    });

    expect(result.current.state.status).toBe('idle');
    expect(safePostMessage).not.toHaveBeenCalled();
  });

  it('reject() emits TEXT_FIX_REJECTED when in preview state', () => {
    const { result } = renderHook(() => useTextFix());
    const el = makeParagraph('teh');

    act(() => {
      result.current.request(el);
    });
    act(() => {
      replyFromParent('TEXT_FIX_RESULT', lastRequestId(), { newText: 'the', changed: true });
    });

    (safePostMessage as unknown as { mockClear: () => void }).mockClear();

    act(() => {
      result.current.reject();
    });

    expect(result.current.state.status).toBe('idle');
    const calls = (safePostMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBe(1);
    const [, payload] = calls[0] as [unknown, { type: string }];
    expect(payload.type).toBe('TEXT_FIX_REJECTED');
  });

  it('reject() does not emit telemetry when not in preview state', () => {
    const { result } = renderHook(() => useTextFix());

    act(() => {
      result.current.reject();
    });

    expect(safePostMessage).not.toHaveBeenCalled();
  });
});

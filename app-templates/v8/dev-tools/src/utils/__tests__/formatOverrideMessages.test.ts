/**
 * @vitest-environment jsdom
 */
/* global MessageEvent, MessageEventSource */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FORMAT_OVERRIDE_REPLY_TIMEOUT_MS,
  FormatOverrideMessageEventType,
  addFormatOverrideEditListener,
  findFormatOverrideElement,
  isLoopRenderedElement,
  readCurrentFormatOverrideMarks,
  readFormatOverrideTarget,
} from '../formatOverrideMessages';

function dispatch(data: Record<string, unknown>, source: unknown = window.parent): void {
  const event = new MessageEvent('message', { data, source: source as MessageEventSource });
  window.dispatchEvent(event);
}

describe('formatOverrideMessages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('extracts a bound-text target from source-mapper attributes', () => {
    const element = document.createElement('h1');
    element.setAttribute('data-dev-id', 'abc123');
    element.setAttribute('data-dev-file', '/app/src/pages/index.tsx');
    element.setAttribute('data-dev-bound-text', 'true');
    element.setAttribute('data-dev-bound-source-kind', 'bound-expression');
    element.setAttribute('data-dev-bound-expression-hash', `sha256:${'a'.repeat(64)}`);

    expect(readFormatOverrideTarget(element)).toEqual({
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        contentKey: null,
        contentKeyTemplate: null,
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
    });
  });

  it('extracts the nearest ancestor bound-text target from formatted children', () => {
    const element = document.createElement('h1');
    element.setAttribute('data-dev-id', 'abc123');
    element.setAttribute('data-dev-file', '/app/src/pages/index.tsx');
    element.setAttribute('data-dev-bound-text', 'true');
    element.setAttribute('data-dev-bound-source-kind', 'bound-expression');
    element.setAttribute('data-dev-bound-expression-hash', `sha256:${'a'.repeat(64)}`);
    element.innerHTML = '<span data-airo-formatted-bound-text="true"><span>Title</span></span>';
    document.body.appendChild(element);

    const child = element.querySelector('span span') as HTMLElement;

    expect(findFormatOverrideElement(child)).toBe(element);
    expect(readFormatOverrideTarget(child)).toEqual({
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        contentKey: null,
        contentKeyTemplate: null,
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
    });
  });

  it('returns null when bound-expression metadata is missing its expression hash', () => {
    const element = document.createElement('h1');
    element.setAttribute('data-dev-id', 'abc123');
    element.setAttribute('data-dev-file', '/app/src/pages/index.tsx');
    element.setAttribute('data-dev-bound-text', 'true');
    element.setAttribute('data-dev-bound-source-kind', 'bound-expression');

    expect(readFormatOverrideTarget(element)).toBeNull();
  });

  it('returns null when content-key metadata is missing its content key', () => {
    const element = document.createElement('h1');
    element.setAttribute('data-dev-id', 'abc123');
    element.setAttribute('data-dev-file', '/app/src/pages/index.tsx');
    element.setAttribute('data-dev-bound-text', 'true');
    element.setAttribute('data-dev-bound-source-kind', 'content-key');

    expect(readFormatOverrideTarget(element)).toBeNull();
  });

  it('returns null when content-key-template metadata is missing its template', () => {
    const element = document.createElement('h1');
    element.setAttribute('data-dev-id', 'abc123');
    element.setAttribute('data-dev-file', '/app/src/pages/index.tsx');
    element.setAttribute('data-dev-bound-text', 'true');
    element.setAttribute('data-dev-bound-source-kind', 'content-key-template');

    expect(readFormatOverrideTarget(element)).toBeNull();
  });

  it('returns null for loop-rendered bound text', () => {
    const first = document.createElement('li');
    const second = document.createElement('li');
    for (const element of [first, second]) {
      element.setAttribute('data-dev-id', 'loopid');
      element.setAttribute('data-dev-line', '7');
      element.setAttribute('data-dev-bound-text', 'true');
      document.body.appendChild(element);
    }

    expect(isLoopRenderedElement(first)).toBe(true);
    expect(readFormatOverrideTarget(first)).toBeNull();
  });

  it('returns null for the format override runtime component', () => {
    const element = document.createElement('span');
    element.setAttribute('data-dev-id', 'abc123');
    element.setAttribute('data-dev-file', '/app/src/components/FormattedBoundText.tsx');
    element.setAttribute('data-dev-bound-text', 'true');
    element.setAttribute('data-dev-bound-source-kind', 'bound-expression');
    element.setAttribute('data-dev-bound-expression-hash', `sha256:${'a'.repeat(64)}`);

    expect(readFormatOverrideTarget(element)).toBeNull();
  });

  it('reads current marks from the runtime formatted child', () => {
    const element = document.createElement('h1');
    element.innerHTML = '<span data-airo-formatted-bound-text="true" data-airo-format-bold="true" data-airo-format-italic="true" data-airo-format-color="#123abc">Title</span>';

    expect(readCurrentFormatOverrideMarks(element)).toEqual({
      bold: true,
      italic: true,
      color: '#123abc',
    });
  });

  it('reads current marks from a child inside the bound-text target', () => {
    const element = document.createElement('h1');
    element.setAttribute('data-dev-id', 'abc123');
    element.setAttribute('data-dev-file', '/app/src/pages/index.tsx');
    element.setAttribute('data-dev-bound-text', 'true');
    element.setAttribute('data-dev-bound-source-kind', 'bound-expression');
    element.setAttribute('data-dev-bound-expression-hash', `sha256:${'a'.repeat(64)}`);
    element.innerHTML = '<span data-airo-formatted-bound-text="true" data-airo-format-bold="true" data-airo-format-italic="true"><span>Title</span></span>';
    document.body.appendChild(element);

    const child = element.querySelector('span span') as HTMLElement;

    expect(readCurrentFormatOverrideMarks(child)).toEqual({
      bold: true,
      italic: true,
      color: null,
    });
  });

  it('returns default marks when no runtime formatted child exists yet', () => {
    const element = document.createElement('h1');
    element.textContent = 'Title';

    expect(readCurrentFormatOverrideMarks(element)).toEqual({
      bold: false,
      italic: false,
      color: null,
    });
  });

  it('correlates format override replies by commitId', () => {
    const handler = vi.fn();
    const commitId = addFormatOverrideEditListener(handler);

    dispatch({ type: FormatOverrideMessageEventType.EDIT_SUCCEEDED, commitId: 'different' });
    expect(handler).not.toHaveBeenCalled();

    dispatch({ type: FormatOverrideMessageEventType.EDIT_SUCCEEDED, commitId });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('detaches the listener after FORMAT_OVERRIDE_REPLY_TIMEOUT_MS', () => {
    const handler = vi.fn();
    const commitId = addFormatOverrideEditListener(handler);

    vi.advanceTimersByTime(FORMAT_OVERRIDE_REPLY_TIMEOUT_MS);
    dispatch({ type: FormatOverrideMessageEventType.EDIT_SUCCEEDED, commitId });

    expect(handler).not.toHaveBeenCalled();
  });

  it('runs the timeout handler when the parent never replies', () => {
    const handler = vi.fn();
    const onTimeout = vi.fn();
    const commitId = addFormatOverrideEditListener(handler, onTimeout);

    vi.advanceTimersByTime(FORMAT_OVERRIDE_REPLY_TIMEOUT_MS);

    expect(onTimeout).toHaveBeenCalledWith({ commitId });
    dispatch({ type: FormatOverrideMessageEventType.EDIT_SUCCEEDED, commitId });
    expect(handler).not.toHaveBeenCalled();
  });
});

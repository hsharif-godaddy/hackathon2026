import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../postMessage', () => ({
  safePostMessage: vi.fn(),
}));

import { send, trackEventBus } from '../eventBus';
import { safePostMessage } from '../postMessage';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('eventBus send', () => {
  it('forwards a typed bus message to window.parent via safePostMessage', () => {
    send({
      type: 'TEXT_FIX_REQUESTED',
      data: { requestId: 'req-1', oldText: '<p>old</p>' },
    });
    expect(safePostMessage).toHaveBeenCalledWith(window.parent, {
      type: 'TEXT_FIX_REQUESTED',
      data: { requestId: 'req-1', oldText: '<p>old</p>' },
    });
  });
});

describe('trackEventBus', () => {
  it('click() sends a TRACK_EVENT click message with eid and properties', () => {
    trackEventBus.click('devtools.toolbar.bold', { surface: 'text' });
    expect(safePostMessage).toHaveBeenCalledWith(window.parent, {
      type: 'TRACK_EVENT',
      kind: 'click',
      eid: 'devtools.toolbar.bold',
      properties: { surface: 'text' },
    });
  });

  it('click() sends a TRACK_EVENT click message with no properties', () => {
    trackEventBus.click('devtools.toolbar.italic');
    expect(safePostMessage).toHaveBeenCalledWith(window.parent, {
      type: 'TRACK_EVENT',
      kind: 'click',
      eid: 'devtools.toolbar.italic',
      properties: undefined,
    });
  });

  it('impression() sends a TRACK_EVENT impression message', () => {
    trackEventBus.impression('devtools.toolbar.view', { surface: 'image' });
    expect(safePostMessage).toHaveBeenCalledWith(window.parent, {
      type: 'TRACK_EVENT',
      kind: 'impression',
      eid: 'devtools.toolbar.view',
      properties: { surface: 'image' },
    });
  });
});

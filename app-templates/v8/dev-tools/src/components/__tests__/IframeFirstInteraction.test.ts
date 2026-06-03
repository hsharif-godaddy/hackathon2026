/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const safePostMessage = vi.fn();

vi.mock('../../utils/postMessage', () => ({
  isOriginAllowed: vi.fn(() => true),
  safePostMessage,
}));

vi.mock('../../utils/screenshot', () => ({
  captureAndResizeScreenshot: vi.fn(async () => null),
  captureViewportScreenshot: vi.fn(async () => null),
}));

vi.mock('../../hooks/useEditMode', () => ({
  useEditMode: vi.fn(() => ({
    hoveredElement: null,
    handleBarMouseEnter: vi.fn(),
    handleBarMouseLeave: vi.fn(),
  })),
}));

vi.mock('../ElementHoverBar', () => ({
  default: () => null,
}));

vi.mock('../../utils/translations', () => ({
  setTranslations: vi.fn(),
}));

vi.mock('../../route-discovery', () => ({
  resolveRouteForModule: vi.fn(async () => null),
}));

import DevelopmentMode from '../DevelopmentMode';

function enableEditMode() {
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'EDIT_MODE_ENABLED' } }));
}

function pointerDown(target: HTMLElement) {
  const EventCtor = window.PointerEvent ?? MouseEvent;
  target.dispatchEvent(new EventCtor('pointerdown', { bubbles: true }));
}

describe('DevelopmentMode iframe first interaction sender', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
  });

  it('fires safePostMessage with IFRAME_FIRST_INTERACTION on first pointerdown when edit mode is active', () => {
    render(<DevelopmentMode />);
    enableEditMode();

    const target = document.createElement('div');
    document.body.appendChild(target);
    pointerDown(target);

    expect(safePostMessage).toHaveBeenCalledWith(window.parent, { type: 'IFRAME_FIRST_INTERACTION' });
  });

  it('does not fire when isEditModeActive is false', () => {
    render(<DevelopmentMode />);

    const target = document.createElement('div');
    document.body.appendChild(target);
    pointerDown(target);

    expect(safePostMessage).not.toHaveBeenCalledWith(window.parent, { type: 'IFRAME_FIRST_INTERACTION' });
  });

  it('does not fire when target is inside dev-tools containers', () => {
    render(<DevelopmentMode />);
    enableEditMode();

    const airoDevTools = document.createElement('div');
    airoDevTools.setAttribute('data-airo-dev-tools', '');
    const airoChild = document.createElement('button');
    airoDevTools.appendChild(airoChild);
    document.body.appendChild(airoDevTools);
    pointerDown(airoChild);

    const devTools = document.createElement('div');
    devTools.setAttribute('data-dev-tools', '');
    const devToolsChild = document.createElement('button');
    devTools.appendChild(devToolsChild);
    document.body.appendChild(devTools);
    pointerDown(devToolsChild);

    const hoverBar = document.createElement('div');
    hoverBar.className = 'edit-mode-hover-bar';
    const hoverChild = document.createElement('button');
    hoverBar.appendChild(hoverChild);
    document.body.appendChild(hoverBar);
    pointerDown(hoverChild);

    expect(safePostMessage).not.toHaveBeenCalledWith(window.parent, { type: 'IFRAME_FIRST_INTERACTION' });
  });

  it('does not fire a second time after first interaction', () => {
    render(<DevelopmentMode />);
    enableEditMode();

    const target = document.createElement('div');
    document.body.appendChild(target);
    pointerDown(target);
    pointerDown(target);
    document.dispatchEvent(new Event('scroll', { bubbles: true }));

    expect(safePostMessage).toHaveBeenCalledTimes(1);
  });

  it('fires on first scroll when edit mode is active', () => {
    render(<DevelopmentMode />);
    enableEditMode();

    document.dispatchEvent(new Event('scroll', { bubbles: true }));

    expect(safePostMessage).toHaveBeenCalledWith(window.parent, { type: 'IFRAME_FIRST_INTERACTION' });
  });

  it('cleans up the other listener after pointerdown fires', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    render(<DevelopmentMode />);
    enableEditMode();

    const target = document.createElement('div');
    document.body.appendChild(target);
    pointerDown(target);

    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  });
});

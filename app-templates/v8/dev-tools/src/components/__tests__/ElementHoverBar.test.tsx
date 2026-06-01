/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { HoveredElement } from '../../hooks/useImageHoverDetection';

vi.mock('../../utils/postMessage', () => ({
  safePostMessage: vi.fn(),
}));

vi.mock('../../utils/element-helpers', () => ({
  extractDevContext: vi.fn(() => ({ devId: 'test-id', fileName: 'test.tsx', lineNumber: 1, componentName: 'Test' })),
  generatePreciseSelector: vi.fn(() => 'div > img'),
  getElementClassName: vi.fn((el: HTMLElement) => el.className),
}));

vi.mock('../../utils/translations', () => ({
  t: vi.fn((_: string, fallback: string) => fallback),
}));

vi.mock('../../utils/device', () => ({
  isTouchDevice: vi.fn(() => false),
}));

vi.mock('../../utils/element-detection', () => ({
  isClickable: vi.fn(() => false),
  isTextElement: vi.fn(() => false),
  isTextBlockElement: vi.fn(() => false),
}));

vi.mock('../../utils/selection-overlay', () => ({
  showSelectionOverlay: vi.fn(),
  addNumberedOverlay: vi.fn(),
  removeNumberedOverlay: vi.fn(),
  getNextSelectionNumber: vi.fn(() => 1),
}));

vi.mock('../../utils/popover-coordinator', () => ({
  nextOpenMenu: vi.fn(() => null),
}));

vi.mock('../../hooks/useTextFix', () => ({
  useTextFix: vi.fn(() => ({
    state: { status: 'idle' },
    request: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    reset: vi.fn(),
  })),
}));

vi.mock('../TextFixPopover', () => ({ default: () => null, TextFixPopover: () => null }));
vi.mock('../TextFixButton', () => ({ default: () => null }));
vi.mock('../QuickEditBar', () => ({ QuickEditBar: () => null }));
vi.mock('../TextAlignButton', () => ({ default: () => null }));
vi.mock('../BoldButton', () => ({ default: () => null }));
vi.mock('../ItalicButton', () => ({ default: () => null }));
vi.mock('../TextColorButton', () => ({ default: () => null }));
vi.mock('../TextSizeStepperButton', () => ({ default: () => null }));

import ElementHoverBar from '../ElementHoverBar';

function makeImageElement(attrs: Record<string, string> = {}): HTMLElement {
  const img = document.createElement('img');
  img.src = 'https://commerce-cdn.example.com/product-1.jpg';
  Object.entries(attrs).forEach(([key, value]) => img.setAttribute(key, value));
  img.getBoundingClientRect = vi.fn(() => ({
    top: 100, left: 100, width: 200, height: 200, right: 300, bottom: 300, x: 100, y: 100, toJSON: () => {},
  } as DOMRect));
  document.body.appendChild(img);
  return img;
}

// toolbarMode is owned by useImageHoverDetection in production, but for unit
// tests we render with toolbarMode=true directly to exercise the open-bar UI.
function renderHoverBar(hoveredElement: HoveredElement) {
  return render(
    createElement(ElementHoverBar, {
      hoveredElement,
      isMultiSelectActive: false,
      toolbarMode: true,
      setToolbarMode: vi.fn(),
      onMouseEnter: vi.fn(),
      onMouseLeave: vi.fn(),
    })
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
});

describe('ElementHoverBar - Commerce product image gating', () => {
  it('shows Replace/Modify for images on non-Commerce apps', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');

    const img = makeImageElement();
    const hovered: HoveredElement = {
      type: 'image',
      element: img,
      imageUrl: 'https://commerce-cdn.example.com/product-1.jpg',
      isMediaSlot: false,
      slotPath: null,
    };

    renderHoverBar(hovered);

    expect(screen.queryByTitle('Replace image')).not.toBeNull();
    expect(screen.queryByTitle('Modify image')).not.toBeNull();
  });

  it('hides Replace/Modify for Commerce product images (no data-dev-id, not a media slot)', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', 'store-123');

    const img = makeImageElement(); // No data-dev-id
    const hovered: HoveredElement = {
      type: 'image',
      element: img,
      imageUrl: 'https://commerce-cdn.example.com/product-1.jpg',
      isMediaSlot: false,
      slotPath: null,
    };

    renderHoverBar(hovered);

    expect(screen.queryByTitle('Replace image')).toBeNull();
    expect(screen.queryByTitle('Modify image')).toBeNull();
  });

  it('shows Replace/Modify for Commerce app images that ARE media slots', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', 'store-123');

    const img = makeImageElement();
    const hovered: HoveredElement = {
      type: 'image',
      element: img,
      imageUrl: '/airo-assets/images/hero.jpg',
      isMediaSlot: true,
      slotPath: 'hero',
    };

    renderHoverBar(hovered);

    expect(screen.queryByTitle('Replace image')).not.toBeNull();
    expect(screen.queryByTitle('Modify image')).not.toBeNull();
  });

  it('shows Replace/Modify for Commerce app images with data-dev-id (user source code)', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', 'store-123');

    const img = makeImageElement({ 'data-dev-id': 'src/pages/index.tsx:15' });
    const hovered: HoveredElement = {
      type: 'image',
      element: img,
      imageUrl: 'https://example.com/banner.jpg',
      isMediaSlot: false,
      slotPath: null,
    };

    renderHoverBar(hovered);

    expect(screen.queryByTitle('Replace image')).not.toBeNull();
    expect(screen.queryByTitle('Modify image')).not.toBeNull();
  });

  it('still shows Reference and Edit with AI for Commerce product images', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', 'store-123');

    const img = makeImageElement();
    const hovered: HoveredElement = {
      type: 'image',
      element: img,
      imageUrl: 'https://commerce-cdn.example.com/product-1.jpg',
      isMediaSlot: false,
      slotPath: null,
    };

    renderHoverBar(hovered);

    expect(screen.queryByTitle('Add as reference')).not.toBeNull();
    expect(screen.queryByTitle('Edit with AI')).not.toBeNull();
  });
});

import { safePostMessage } from '../../utils/postMessage';

const trackCalls = () =>
  vi.mocked(safePostMessage).mock.calls.filter(
    ([, msg]) => (msg as { type?: string })?.type === 'TRACK_EVENT',
  );

const findTrackCall = (eid: string) =>
  trackCalls().find(([, msg]) => (msg as { eid?: string })?.eid === eid);

function makeTextHover(): HoveredElement {
  const p = document.createElement('p');
  p.textContent = 'Hello world';
  p.getBoundingClientRect = vi.fn(() => ({
    top: 100, left: 100, width: 200, height: 30, right: 300, bottom: 130, x: 100, y: 100, toJSON: () => {},
  } as DOMRect));
  document.body.appendChild(p);
  return { type: 'text', element: p } as HoveredElement;
}

describe('ElementHoverBar - tracking', () => {
  it('fires toolbar-view impression with surface=image when toolbar opens on an image', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    const hovered: HoveredElement = {
      type: 'image', element: img, imageUrl: 'x', isMediaSlot: false, slotPath: null,
    };
    renderHoverBar(hovered);
    fireEvent.click(img);
    expect(findTrackCall('devtools.toolbar.view')).toEqual([
      window.parent,
      { type: 'TRACK_EVENT', kind: 'impression', eid: 'devtools.toolbar.view', properties: { surface: 'image' } },
    ]);
  });

  it('fires toolbar-view impression with surface=text when toolbar opens on a text element', () => {
    const hovered = makeTextHover();
    renderHoverBar(hovered);
    fireEvent.click(hovered.element);
    expect(findTrackCall('devtools.toolbar.view')).toEqual([
      window.parent,
      { type: 'TRACK_EVENT', kind: 'impression', eid: 'devtools.toolbar.view', properties: { surface: 'text' } },
    ]);
  });

  it('fires replace_image click when Replace is clicked', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    const hovered: HoveredElement = {
      type: 'image', element: img, imageUrl: 'https://x/y.jpg', isMediaSlot: false, slotPath: null,
    };
    renderHoverBar(hovered);
    fireEvent.click(img);
    fireEvent.click(screen.getByTitle('Replace image'));
    expect(findTrackCall('devtools.toolbar.replace_image')).toBeTruthy();
  });

  it('fires modify_image click when Modify is clicked', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    const hovered: HoveredElement = {
      type: 'image', element: img, imageUrl: 'https://x/y.jpg', isMediaSlot: false, slotPath: null,
    };
    renderHoverBar(hovered);
    fireEvent.click(img);
    fireEvent.click(screen.getByTitle('Modify image'));
    expect(findTrackCall('devtools.toolbar.modify_image')).toBeTruthy();
  });

  it('fires multi_select_add click when Reference is clicked', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    const hovered: HoveredElement = {
      type: 'image', element: img, imageUrl: 'https://x/y.jpg', isMediaSlot: false, slotPath: null,
    };
    renderHoverBar(hovered);
    fireEvent.click(img);
    fireEvent.click(screen.getByTitle('Add as reference'));
    expect(findTrackCall('devtools.toolbar.multi_select_add')).toBeTruthy();
  });

  it('fires sparkles click when Edit with AI is clicked', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    const hovered: HoveredElement = {
      type: 'image', element: img, imageUrl: 'https://x/y.jpg', isMediaSlot: false, slotPath: null,
    };
    renderHoverBar(hovered);
    fireEvent.click(img);
    fireEvent.click(screen.getByTitle('Edit with AI'));
    expect(findTrackCall('devtools.toolbar.sparkles')).toBeTruthy();
  });
});

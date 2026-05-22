/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

function renderHoverBar(hoveredElement: HoveredElement) {
  return render(
    createElement(ElementHoverBar, {
      hoveredElement,
      isMultiSelectActive: false,
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

    // Click to open toolbar
    fireEvent.click(img);

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
    fireEvent.click(img);

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
    fireEvent.click(img);

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
    fireEvent.click(img);

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
    fireEvent.click(img);

    expect(screen.queryByTitle('Add as reference')).not.toBeNull();
    expect(screen.queryByTitle('Edit with AI')).not.toBeNull();
  });
});

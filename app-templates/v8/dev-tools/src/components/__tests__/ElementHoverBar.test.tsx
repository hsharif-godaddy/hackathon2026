/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import type { HoveredElement } from '../../hooks/useImageHoverDetection';
import { safePostMessage } from '../../utils/postMessage';
import { computePopoverPlacement } from '../ElementHoverBar';

type ImageHoveredElement = Extract<HoveredElement, { type: 'image' }>;

const textFixMock = vi.hoisted(() => ({
  request: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  reset: vi.fn(),
}));

const formatOverrideControlsMock = vi.hoisted(() => ({
  render: vi.fn(),
}));

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
  isListElement: vi.fn(() => false),
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
    request: textFixMock.request,
    accept: textFixMock.accept,
    reject: textFixMock.reject,
    reset: textFixMock.reset,
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
vi.mock('../FormatOverrideControls', () => ({
  default: (props: unknown) => {
    formatOverrideControlsMock.render(props);
    return <button title="Bound format controls" />;
  },
}));

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

function makeImageHover(
  element: HTMLElement,
  overrides: Partial<Omit<ImageHoveredElement, 'type' | 'element'>> = {},
): ImageHoveredElement {
  return {
    type: 'image',
    element,
    imageUrl: 'https://commerce-cdn.example.com/product-1.jpg',
    isMediaSlot: false,
    slotPath: null,
    isVideo: false,
    ...overrides,
  };
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

function openToolbar(element: HTMLElement): void {
  fireEvent.click(element);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
  });
});

describe('ElementHoverBar - Commerce product image gating', () => {
  it('shows Replace/Modify for images on non-Commerce apps', async () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');

    const img = makeImageElement();
    const hovered = makeImageHover(img);

    renderHoverBar(hovered);

    openToolbar(img);

    expect(await screen.findByRole('button', { name: 'Replace' })).not.toBeNull();
    expect(await screen.findByRole('button', { name: 'Modify' })).not.toBeNull();
  });

  it('hides Replace/Modify for Commerce product images (no data-dev-id, not a media slot)', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', 'store-123');

    const img = makeImageElement(); // No data-dev-id
    const hovered = makeImageHover(img);

    renderHoverBar(hovered);
    openToolbar(img);

    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Modify' })).toBeNull();
  });

  it('shows Replace/Modify for Commerce app images that ARE media slots', async () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', 'store-123');

    const img = makeImageElement();
    const hovered = makeImageHover(img, {
      imageUrl: '/airo-assets/images/hero.jpg',
      isMediaSlot: true,
      slotPath: 'hero',
    });

    renderHoverBar(hovered);
    openToolbar(img);

    expect(await screen.findByRole('button', { name: 'Replace' })).not.toBeNull();
    expect(await screen.findByRole('button', { name: 'Modify' })).not.toBeNull();
  });

  it('shows Replace/Modify for Commerce app images with data-dev-id (user source code)', async () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', 'store-123');

    const img = makeImageElement({ 'data-dev-id': 'src/pages/index.tsx:15' });
    const hovered = makeImageHover(img, {
      imageUrl: 'https://example.com/banner.jpg',
    });

    renderHoverBar(hovered);
    openToolbar(img);

    expect(await screen.findByRole('button', { name: 'Replace' })).not.toBeNull();
    expect(await screen.findByRole('button', { name: 'Modify' })).not.toBeNull();
  });

  it('still shows Reference but hides Edit with AI for Commerce product images', async () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', 'store-123');

    const img = makeImageElement();
    const hovered = makeImageHover(img);

    renderHoverBar(hovered);
    openToolbar(img);

    expect(await screen.findByRole('button', { name: 'Add as reference' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit with AI' })).toBeNull();
  });

  it('hides image mutation actions for direct-DOM Commerce product images', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');

    const root = document.createElement('article');
    root.setAttribute('data-dev-source-origin', 'commerce');
    root.setAttribute('data-dev-commerce-product-id', 'sku-group-1');
    const img = makeImageElement({ 'data-dev-id': 'src/pages/Product.tsx:15' });
    root.appendChild(img);
    document.body.appendChild(root);
    const hovered = makeImageHover(img);

    renderHoverBar(hovered);
    openToolbar(img);

    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Modify' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});

describe('ElementHoverBar - Commerce product text gating', () => {
  it('hides Quick Edit for direct-DOM Commerce product text', async () => {
    const detection = await import('../../utils/element-detection');
    vi.mocked(detection.isTextElement).mockReturnValue(true);

    const root = document.createElement('article');
    root.setAttribute('data-dev-source-origin', 'commerce');
    root.setAttribute('data-dev-commerce-product-id', 'sku-group-1');
    const h2 = document.createElement('h2');
    h2.textContent = 'Commerce product';
    h2.getBoundingClientRect = vi.fn(() => ({
      top: 100, left: 100, width: 200, height: 50, right: 300, bottom: 150, x: 100, y: 100, toJSON: () => {},
    } as DOMRect));
    root.appendChild(h2);
    document.body.appendChild(root);

    renderHoverBar({ type: 'content', element: h2 });
    openToolbar(h2);

    expect(await screen.findByRole('button', { name: 'Add as reference' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit with AI' })).toBeNull();
  });
});

describe('ElementHoverBar - link follow bar', () => {
  it('shows link follow bar below links and removes toolbar follow icon', async () => {
    const detection = await import('../../utils/element-detection');
    vi.mocked(detection.isClickable).mockReturnValue(true);

    const anchor = document.createElement('a');
    anchor.href = 'https://loom.com/share/c587cabe155a499fa63ae88fe0d61d23';
    anchor.textContent = 'Loom';
    anchor.getBoundingClientRect = vi.fn(() => ({
      top: 100, left: 100, width: 120, height: 24, right: 220, bottom: 124, x: 100, y: 100, toJSON: () => {},
    } as DOMRect));
    document.body.appendChild(anchor);

    renderHoverBar({ type: 'content', element: anchor });
    openToolbar(anchor);

    expect(screen.queryByTitle('Follow link')).toBeNull();
    expect(await screen.findByTestId('devtools-link-follow-destination')).not.toBeNull();
    expect(screen.getByText(/Go to: loom\.com\/share\//)).toBeTruthy();
  });
});

describe('ElementHoverBar - bound text formatting gating', () => {
  it('shows bound format controls for eligible bound text', async () => {
    const detection = await import('../../utils/element-detection');
    vi.mocked(detection.isTextElement).mockReturnValue(true);

    const h1 = document.createElement('h1');
    h1.textContent = 'Title';
    h1.setAttribute('data-dev-id', 'abc123');
    h1.setAttribute('data-dev-line', '7');
    h1.setAttribute('data-dev-file', '/app/src/pages/index.tsx');
    h1.setAttribute('data-dev-bound-text', 'true');
    h1.setAttribute('data-dev-bound-source-kind', 'bound-expression');
    h1.setAttribute('data-dev-bound-expression-hash', `sha256:${'a'.repeat(64)}`);
    h1.getBoundingClientRect = vi.fn(() => ({
      top: 100, left: 100, width: 200, height: 50, right: 300, bottom: 150, x: 100, y: 100, toJSON: () => {},
    } as DOMRect));
    document.body.appendChild(h1);

    renderHoverBar({ type: 'content', element: h1 });
    openToolbar(h1);

    expect(await screen.findByTitle('Bound format controls')).not.toBeNull();
  });

  it('uses ancestor bound format controls for children inside bound text', async () => {
    const detection = await import('../../utils/element-detection');
    vi.mocked(detection.isTextElement).mockReturnValue(true);

    const h1 = document.createElement('h1');
    h1.setAttribute('data-dev-id', 'abc123');
    h1.setAttribute('data-dev-line', '7');
    h1.setAttribute('data-dev-file', '/app/src/pages/index.tsx');
    h1.setAttribute('data-dev-bound-text', 'true');
    h1.setAttribute('data-dev-bound-source-kind', 'bound-expression');
    h1.setAttribute('data-dev-bound-expression-hash', `sha256:${'a'.repeat(64)}`);

    const child = document.createElement('span');
    child.textContent = 'Title';
    child.getBoundingClientRect = vi.fn(() => ({
      top: 100, left: 100, width: 200, height: 50, right: 300, bottom: 150, x: 100, y: 100, toJSON: () => {},
    } as DOMRect));
    h1.appendChild(child);
    document.body.appendChild(h1);

    renderHoverBar({ type: 'content', element: child });
    openToolbar(child);

    expect(await screen.findByTitle('Bound format controls')).not.toBeNull();
    expect(formatOverrideControlsMock.render).toHaveBeenCalledWith(expect.objectContaining({ selectedElement: h1 }));
  });

  it('blocks bound format controls for loop-rendered bound text', async () => {
    const first = document.createElement('li');
    const second = document.createElement('li');
    for (const li of [first, second]) {
      li.textContent = 'Product';
      li.setAttribute('data-dev-id', 'loopid');
      li.setAttribute('data-dev-line', '9');
      li.setAttribute('data-dev-file', '/app/src/pages/index.tsx');
      li.setAttribute('data-dev-bound-text', 'true');
      li.setAttribute('data-dev-bound-source-kind', 'content-key-template');
      li.getBoundingClientRect = vi.fn(() => ({
        top: 100, left: 100, width: 200, height: 50, right: 300, bottom: 150, x: 100, y: 100, toJSON: () => {},
      } as DOMRect));
      document.body.appendChild(li);
    }

    renderHoverBar({ type: 'content', element: first });
    openToolbar(first);

    expect(await screen.findByRole('button', { name: 'Add as reference' })).not.toBeNull();
    expect(screen.queryByTitle('Bound format controls')).toBeNull();
  });
});

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
  return { type: 'content', element: p };
}

describe('ElementHoverBar - tracking', () => {
  it('fires toolbar-view impression with surface=image when toolbar opens on an image', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    const hovered = makeImageHover(img, { imageUrl: 'x' });
    renderHoverBar(hovered);
    openToolbar(img);
    expect(findTrackCall('devtools.toolbar.view')).toEqual([
      window.parent,
      { type: 'TRACK_EVENT', kind: 'impression', eid: 'devtools.toolbar.view', properties: { surface: 'image' } },
    ]);
  });

  it('fires toolbar-view impression with surface=text when toolbar opens on a text element', () => {
    const hovered = makeTextHover();
    renderHoverBar(hovered);
    openToolbar(hovered.element);
    expect(findTrackCall('devtools.toolbar.view')).toEqual([
      window.parent,
      { type: 'TRACK_EVENT', kind: 'impression', eid: 'devtools.toolbar.view', properties: { surface: 'text' } },
    ]);
  });

  it('fires replace_image click when Replace is clicked', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    const hovered = makeImageHover(img, { imageUrl: 'https://x/y.jpg' });
    renderHoverBar(hovered);
    openToolbar(img);
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(findTrackCall('devtools.toolbar.replace_image')).toBeTruthy();
  });

  it('fires modify_image click when Modify is clicked', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    const hovered = makeImageHover(img, { imageUrl: 'https://x/y.jpg' });
    renderHoverBar(hovered);
    openToolbar(img);
    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
    expect(findTrackCall('devtools.toolbar.modify_image')).toBeTruthy();
  });

  it('fires multi_select_add click when Reference is clicked', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    const hovered = makeImageHover(img, { imageUrl: 'https://x/y.jpg' });
    renderHoverBar(hovered);
    openToolbar(img);
    fireEvent.click(screen.getByRole('button', { name: 'Add as reference' }));
    expect(findTrackCall('devtools.toolbar.multi_select_add')).toBeTruthy();
  });

  it('fires sparkles click when Edit with AI is clicked', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    const hovered = makeImageHover(img, { imageUrl: 'https://x/y.jpg' });
    renderHoverBar(hovered);
    openToolbar(img);
    fireEvent.click(screen.getByRole('button', { name: 'Edit with AI' }));
    expect(findTrackCall('devtools.toolbar.sparkles')).toBeTruthy();
  });
});

const findDeleteMediaCall = () =>
  vi.mocked(safePostMessage).mock.calls.find(
    ([, msg]) => (msg as { type?: string })?.type === 'DELETE_MEDIA_ELEMENT',
  );

describe('ElementHoverBar - delete media button', () => {
  it('renders Delete for an image', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    renderHoverBar(makeImageHover(img));
    openToolbar(img);
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeNull();
  });

  it('does not render Delete for a non-image element', () => {
    renderHoverBar(makeTextHover());
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('sends DELETE_MEDIA_ELEMENT with elementInfo/devContext when Delete is clicked', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement({ alt: 'A product photo' });
    renderHoverBar(makeImageHover(img, { imageUrl: 'https://x/y.jpg' }));
    openToolbar(img);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const call = findDeleteMediaCall();
    expect(call).toBeTruthy();
    const msg = call![1] as {
      type: string;
      data: {
        selector: string;
        preciseSelector: string;
        devContext?: unknown;
        elementInfo?: { tagName?: string; devContext?: unknown };
        isVideo: boolean;
        imageUrl: string | null;
        alt?: string;
      };
    };
    expect(msg.type).toBe('DELETE_MEDIA_ELEMENT');
    expect(msg.data.preciseSelector).toBe('div > img');
    expect(msg.data.selector).toBe('div > img');
    expect(msg.data.isVideo).toBe(false);
    expect(msg.data.imageUrl).toBe('https://x/y.jpg');
    expect(msg.data.alt).toBe('A product photo');
    expect(msg.data.devContext).toMatchObject({ devId: 'test-id' });
    expect(msg.data.elementInfo).toMatchObject({ tagName: 'img', devContext: { devId: 'test-id' } });
  });

  it('reports isVideo from the captured hovered element', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    renderHoverBar(makeImageHover(img, { isVideo: true }));
    openToolbar(img);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const call = findDeleteMediaCall();
    expect(call).toBeTruthy();
    expect((call![1] as { data: { isVideo: boolean } }).data.isVideo).toBe(true);
  });

  it('fires delete_media click tracking when Delete is clicked', () => {
    vi.stubEnv('VITE_GODADDY_STORE_ID', '');
    const img = makeImageElement();
    renderHoverBar(makeImageHover(img, { imageUrl: 'https://x/y.jpg' }));
    openToolbar(img);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(findTrackCall('devtools.toolbar.delete_media')).toBeTruthy();
  });
});

describe('computePopoverPlacement', () => {
  it('returns "below" when there is enough space below', () => {
    expect(computePopoverPlacement(400, 500, 360)).toBe('below');
  });

  it('returns "above" when not enough space below but enough above', () => {
    expect(computePopoverPlacement(100, 500, 360)).toBe('above');
  });

  it('returns "below" as fallback when neither direction fits', () => {
    expect(computePopoverPlacement(100, 100, 360)).toBe('below');
  });

  it('returns "below" when space below exactly equals picker height', () => {
    expect(computePopoverPlacement(360, 200, 360)).toBe('below');
  });

  it('returns "above" when space below is 1px short', () => {
    expect(computePopoverPlacement(359, 400, 360)).toBe('above');
  });
});

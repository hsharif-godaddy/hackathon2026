/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import {
  computeHoverBarStyle,
  computeLinkFollowBarStyle,
  type Bounds,
  type Viewport,
} from '../hover-bar-placement.js';

const GAP = 8;
const OUTLINE_PAD = 8;
const ESTIMATED_TOOLBAR_HEIGHT = 40;
const BAR_STACK_GAP = 6;

const viewport: Viewport = { width: 1200, height: 800 };

function bounds(overrides: Partial<Bounds> & Pick<Bounds, 'top' | 'bottom'>): Bounds {
  const top = overrides.top;
  const bottom = overrides.bottom;
  const left = overrides.left ?? 100;
  const width = overrides.width ?? 120;
  return {
    top,
    left,
    right: overrides.right ?? left + width,
    bottom,
    width,
  };
}

describe('hover-bar-placement', function packageTests() {
  describe('#computeHoverBarStyle', function hoverBarStyleTests() {
    it('places toolbar above when there is clearance', function aboveClearance() {
      const result = computeHoverBarStyle(bounds({ top: 250, bottom: 274 }), viewport);
      expect(result.placement).toBe('above');
      expect(result.style.top).toBe('234px');
      expect(String(result.style.transform)).toMatch(/-100%/);
    });

    it('places toolbar below when there is not enough clearance above', function belowClearance() {
      const result = computeHoverBarStyle(bounds({ top: 50, bottom: 74 }), viewport);
      expect(result.placement).toBe('below');
      expect(result.style.top).toBe('90px');
    });
  });

  describe('#computeLinkFollowBarStyle', function linkFollowStyleTests() {
    it('places link bar below the element when toolbar is above', function belowElement() {
      const result = computeLinkFollowBarStyle(bounds({ top: 250, bottom: 274 }), 'above', viewport);
      expect(result.placement).toBe('below');
      expect(result.style.top).toBe('290px');
    });

    it('stacks link bar below toolbar when toolbar is below', function stackBelowToolbar() {
      const elementBounds = bounds({ top: 50, bottom: 74 });
      const toolbar = computeHoverBarStyle(elementBounds, viewport);
      const link = computeLinkFollowBarStyle(elementBounds, toolbar.placement, viewport);
      const toolbarTop = elementBounds.bottom + GAP + OUTLINE_PAD;
      const linkTop = Number.parseFloat(String(link.style.top));

      expect(toolbar.placement).toBe('below');
      expect(link.placement).toBe('below');
      expect(linkTop).toBe(toolbarTop + ESTIMATED_TOOLBAR_HEIGHT + BAR_STACK_GAP);
      expect(linkTop).toBeGreaterThan(toolbarTop);
    });

    it('flips link bar above footer links when there is no room below', function flipAboveFooter() {
      const elementBounds = bounds({ top: 760, bottom: 784 });
      const toolbar = computeHoverBarStyle(elementBounds, viewport);
      const link = computeLinkFollowBarStyle(elementBounds, toolbar.placement, viewport);

      expect(toolbar.placement).toBe('above');
      expect(link.placement).toBe('above');
      expect(link.style.top).toBe('744px');
      expect(String(link.style.transform)).toMatch(/-100%/);
    });
  });
});

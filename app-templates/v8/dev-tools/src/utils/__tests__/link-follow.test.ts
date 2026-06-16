/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  followClickableElement,
  formatLinkDisplayUrl,
  resolveFollowTarget,
} from '../link-follow.js';

function buildElement(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const element = doc.body.firstElementChild as HTMLElement | null;
  if (!element) throw new Error(`fixture produced no element: ${JSON.stringify(html)}`);
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('link-follow', function packageTests() {
  describe('#formatLinkDisplayUrl', function formatTests() {
    it('strips protocol and truncates long paths', function truncate() {
      const formatted = formatLinkDisplayUrl('https://loom.com/share/c587cabe155a499fa63ae88fe0d61d23');
      expect(formatted.startsWith('loom.com/share/')).toBe(true);
      expect(formatted.length).toBeLessThanOrEqual(36);
    });

    it('includes hash fragments in the display label', function hashFragment() {
      expect(formatLinkDisplayUrl('#contact')).toBe(`${window.location.host}/#contact`);
      expect(formatLinkDisplayUrl('/about#team')).toBe(`${window.location.host}/about#team`);
    });
  });

  describe('#resolveFollowTarget', function resolveTests() {
    it('returns link target for anchors', function anchor() {
      const anchor = buildElement('<a href="https://example.com/pricing">Pricing</a>');
      expect(resolveFollowTarget(anchor)).toEqual({
        kind: 'link',
        href: 'https://example.com/pricing',
        displayUrl: 'example.com/pricing',
      });
    });

    it('returns button target for buttons without href', function button() {
      const button = buildElement('<button type="button">Go</button>');
      expect(resolveFollowTarget(button)).toEqual({ kind: 'button' });
    });

    it('returns button target for onclick-only elements', function onclick() {
      const div = buildElement('<div onclick="void(0)">Act</div>');
      expect(resolveFollowTarget(div)).toEqual({ kind: 'button' });
    });
  });

  describe('#followClickableElement', function followTests() {
    it('assigns location for same-window anchors', function assign() {
      const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
      const anchor = buildElement('<a href="/contact">Contact</a>');

      expect(followClickableElement(anchor)).toBe(true);
      expect(assignSpy).toHaveBeenCalledWith(`${window.location.origin}/contact`);
    });

    it('clicks buttons when no anchor is present', function clickButton() {
      const button = buildElement('<button type="button">Go</button>');
      const clickSpy = vi.spyOn(button, 'click');

      expect(followClickableElement(button)).toBe(true);
      expect(clickSpy).toHaveBeenCalled();
    });
  });
});

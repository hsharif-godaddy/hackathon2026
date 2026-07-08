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
    it('shows domain + first path segment for long external URLs', function truncate() {
      expect(formatLinkDisplayUrl('https://loom.com/share/c587cabe155a499fa63ae88fe0d61d23'))
        .toBe('loom.com · /share');
      expect(formatLinkDisplayUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'))
        .toBe('youtube.com · /watch');
      expect(formatLinkDisplayUrl('https://www.instagram.com/reel/CxYzAbcDefGhIj'))
        .toBe('instagram.com · /reel');
    });

    it('shows compact URL for short external links', function shortExternal() {
      expect(formatLinkDisplayUrl('https://example.com/pricing')).toBe('example.com/pricing');
      expect(formatLinkDisplayUrl('https://www.example.com/pricing')).toBe('example.com/pricing');
    });

    it('shows friendly page name for internal links', function internalPage() {
      expect(formatLinkDisplayUrl('/contact')).toBe('Contact');
      expect(formatLinkDisplayUrl('/about-us')).toBe('About Us');
      expect(formatLinkDisplayUrl('/')).toBe('Home');
    });

    it('includes hash fragments in the friendly name', function hashFragment() {
      expect(formatLinkDisplayUrl('#contact')).toBe('Contact');
      expect(formatLinkDisplayUrl('/about#team')).toBe('About');
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

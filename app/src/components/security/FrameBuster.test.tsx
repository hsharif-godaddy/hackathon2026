/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import FrameBuster from './FrameBuster';

describe('FrameBuster', () => {
  const originalTop = window.top;
  const originalSelf = window.self;
  let replaceMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replaceMock = vi.fn();
    // Reset referrer to empty before each test
    Object.defineProperty(document, 'referrer', { value: '', configurable: true, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'top', { value: originalTop, writable: true, configurable: true });
    Object.defineProperty(window, 'self', { value: originalSelf, writable: true, configurable: true });
  });

  it('renders nothing', () => {
    const { container } = render(<FrameBuster />);
    expect(container.innerHTML).toBe('');
  });

  it('does not redirect when not in an iframe', () => {
    // window.self === window.top by default in jsdom
    render(<FrameBuster />);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  describe('when inside an iframe', () => {
    beforeEach(() => {
      // Simulate being inside an iframe: self !== top
      const fakeTop = {
        location: { replace: replaceMock } as unknown as Location,
      };
      Object.defineProperty(window, 'top', { value: fakeTop, writable: true, configurable: true });
      Object.defineProperty(window, 'self', { value: {}, writable: true, configurable: true });
    });

    it('redirects top window when parent is not an allowed origin', () => {
      Object.defineProperty(document, 'referrer', { value: 'https://evil-site.com/page', configurable: true });

      render(<FrameBuster />);

      expect(replaceMock).toHaveBeenCalledWith(window.location.href);
    });

    it('redirects when referrer is empty (unknown parent)', () => {
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });

      render(<FrameBuster />);

      expect(replaceMock).toHaveBeenCalledWith(window.location.href);
    });

    it('does not redirect when parent is dashboard.godaddy.com', () => {
      Object.defineProperty(document, 'referrer', { value: 'https://dashboard.godaddy.com/some/path', configurable: true });

      render(<FrameBuster />);

      expect(replaceMock).not.toHaveBeenCalled();
    });

    it('does not redirect when parent is dashboard.dev-godaddy.com', () => {
      Object.defineProperty(document, 'referrer', { value: 'https://dashboard.dev-godaddy.com/', configurable: true });

      render(<FrameBuster />);

      expect(replaceMock).not.toHaveBeenCalled();
    });

    it('does not redirect when parent is dashboard.test-godaddy.com', () => {
      Object.defineProperty(document, 'referrer', { value: 'https://dashboard.test-godaddy.com/app', configurable: true });

      render(<FrameBuster />);

      expect(replaceMock).not.toHaveBeenCalled();
    });

    it('does not redirect when parent is dashboard.dev-godaddy.com on a non-standard port', () => {
      Object.defineProperty(document, 'referrer', { value: 'https://dashboard.dev-godaddy.com:8844/venture', configurable: true });

      render(<FrameBuster />);

      expect(replaceMock).not.toHaveBeenCalled();
    });

    it('redirects when parent is a subdomain lookalike', () => {
      Object.defineProperty(document, 'referrer', { value: 'https://dashboard.fake-godaddy.com/', configurable: true });

      render(<FrameBuster />);

      expect(replaceMock).toHaveBeenCalledWith(window.location.href);
    });

    it('redirects when parent uses http instead of https', () => {
      Object.defineProperty(document, 'referrer', { value: 'http://dashboard.godaddy.com/', configurable: true });

      render(<FrameBuster />);

      expect(replaceMock).toHaveBeenCalledWith(window.location.href);
    });

    it('uses ancestorOrigins when available (Chrome/Safari)', () => {
      // referrer points to an evil site, but ancestorOrigins overrides
      Object.defineProperty(document, 'referrer', { value: 'https://evil-site.com/', configurable: true });

      Object.defineProperty(window.location, 'ancestorOrigins', {
        value: { length: 1, 0: 'https://dashboard.godaddy.com', item: (i: number) => i === 0 ? 'https://dashboard.godaddy.com' : null, contains: () => false },
        configurable: true,
      });

      render(<FrameBuster />);

      expect(replaceMock).not.toHaveBeenCalled();

      // Cleanup
      Object.defineProperty(window.location, 'ancestorOrigins', { value: undefined, configurable: true });
    });

    it('uses ancestorOrigins with non-standard port (Chrome/Safari)', () => {
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });

      Object.defineProperty(window.location, 'ancestorOrigins', {
        value: { length: 1, 0: 'https://dashboard.dev-godaddy.com:8844', item: (i: number) => i === 0 ? 'https://dashboard.dev-godaddy.com:8844' : null, contains: () => false },
        configurable: true,
      });

      render(<FrameBuster />);

      expect(replaceMock).not.toHaveBeenCalled();

      // Cleanup
      Object.defineProperty(window.location, 'ancestorOrigins', { value: undefined, configurable: true });
    });
  });

  describe('when cross-origin access throws', () => {
    it('catches the error silently without redirecting', () => {
      // Simulate: self !== top, but accessing top.location throws (cross-origin)
      const throwingTop = new Proxy({}, {
        get(_target, prop) {
          if (prop === 'location') {
            throw new DOMException('Blocked', 'SecurityError');
          }
          return undefined;
        },
      });
      Object.defineProperty(window, 'top', { value: throwingTop, writable: true, configurable: true });
      Object.defineProperty(window, 'self', { value: {}, writable: true, configurable: true });
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });

      // Should not throw — the catch block handles it silently
      expect(() => render(<FrameBuster />)).not.toThrow();
      expect(replaceMock).not.toHaveBeenCalled();
    });
  });
});

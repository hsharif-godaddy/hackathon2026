/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';

import { isLocalDev } from './is-local-dev';

function withHostname(hostname: string, fn: () => void) {
  const original = window.location.hostname;
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname },
    writable: true,
    configurable: true,
  });
  try {
    fn();
  } finally {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hostname: original },
      writable: true,
      configurable: true,
    });
  }
}

describe('isLocalDev', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '::1',
    '192.168.1.1',
    '192.168.0.100',
    '10.0.0.1',
    '10.255.255.255',
    'local.gasket.dev-godaddy.com',
    'foo.gasket.dev-godaddy.com',
  ])('returns true for %s', (hostname) => {
    withHostname(hostname, () => {
      expect(isLocalDev()).toBe(true);
    });
  });

  it.each([
    'airo-builder.dev-godaddy.com',
    'example.com',
    'gasket.dev-godaddy.com',
    'app.godaddy.com',
  ])('returns false for %s', (hostname) => {
    withHostname(hostname, () => {
      expect(isLocalDev()).toBe(false);
    });
  });

  it('returns false when window is undefined (SSR)', () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error - simulating SSR
    delete globalThis.window;
    try {
      expect(isLocalDev()).toBe(false);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

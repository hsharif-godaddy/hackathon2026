import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThinkingDaddyGraphic } from '../ThinkingDaddyGraphic';

function mockMatchMedia(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(function matchMedia(query: string) {
    return {
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  });
}

describe('ThinkingDaddyGraphic', () => {
  afterEach(function cleanup() {
    vi.restoreAllMocks();
  });

  it('skips rAF smile/hair/brow loops when prefers-reduced-motion is reduce', function reducedMotion() {
    mockMatchMedia(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(function raf() {
      return 0;
    });

    render(<ThinkingDaddyGraphic />);

    expect(raf).not.toHaveBeenCalled();
  });

  it('starts rAF loops when motion is not reduced', function fullMotion() {
    mockMatchMedia(false);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(function raf() {
      return 0;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(function cancel() {});

    render(<ThinkingDaddyGraphic />);

    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });
});

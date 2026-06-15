// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { AssemblingKit } from '../AssemblingKit';

// Fully-assembled brand data (every data-driven row filled). The logo row isn't
// in brand-data — it's driven by the `logo-generated` window event — so the kit
// only becomes complete once that event fires, which is when the packaging
// payoff should start.
vi.mock('../useBrandData', () => ({
  useBrandData: () => ({
    data: {
      kit: { name: 'Volt' },
      palette: { name: 'Indigo', primary: '#3b5bdb', background: '#ffffff' },
      typography: { name: 'Modern Professional', heading: { family: 'Oswald', weights: ['600'] }, body: { family: 'Inter', weights: ['400'] } },
      imagery: { keyword: 'warm artisan linen', moodImages: [{ slot: 'brand/mood-1', url: 'https://cdn/1' }] },
      voice: { weAre: ['bold', 'warm'] },
      summary: { text: 'A bold, modern brand for makers.' },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe('AssemblingKit — packaging payoff', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for step 3, then plays the payoff and fires onAssembled exactly once', () => {
    const onAssembled = vi.fn();
    const { rerender } = render(<AssemblingKit appId="app1" step={2} onAssembled={onAssembled} />);

    // Complete the kit at step 2: the logo is the last piece (arrives via event).
    act(() => {
      window.dispatchEvent(new CustomEvent('logo-generated', { detail: { appId: 'app1' } }));
    });

    // Kit is complete but the agent is still on step 2 — the payoff must NOT
    // play, and the wizard must NOT be released, no matter how much time passes.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onAssembled).not.toHaveBeenCalled();

    // Agent advances to step 3 → the payoff kicks off (still mid-flight).
    rerender(<AssemblingKit appId="app1" step={3} onAssembled={onAssembled} />);
    expect(onAssembled).not.toHaveBeenCalled();

    // Once the seal animation window elapses, the wizard is released — once.
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(onAssembled).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from 'vitest';

import {
  applyWhatsNewModalAction,
  normalizeWhatsNewModalState,
  shouldShowWhatsNewModal,
  type WhatsNewModalState,
} from './whats-new-modal-state';

describe('whats-new-modal-state', () => {
  it('normalizes malformed state and caps view counts', () => {
    const state: WhatsNewModalState = normalizeWhatsNewModalState({
      desktop: { viewCount: 99, lastViewedAt: '2026-07-07T10:00:00.000Z' },
      mobile: { viewCount: -1, completedAt: 123 },
    });

    expect(state).toEqual({
      desktop: { viewCount: 2, lastViewedAt: '2026-07-07T10:00:00.000Z' },
      mobile: { viewCount: 0 },
    });
  });

  it('shows until two views or completion', () => {
    const state: WhatsNewModalState = normalizeWhatsNewModalState({
      desktop: { viewCount: 1 },
      mobile: { viewCount: 1, completedAt: '2026-07-07T10:00:00.000Z' },
    });

    expect(shouldShowWhatsNewModal(state, 'desktop')).toBe(true);
    expect(shouldShowWhatsNewModal(applyWhatsNewModalAction(state, 'desktop', 'viewed', 'now'), 'desktop')).toBe(false);
    expect(shouldShowWhatsNewModal(state, 'mobile')).toBe(false);
  });

  it('preserves first completion timestamp', () => {
    const state: WhatsNewModalState = normalizeWhatsNewModalState({ desktop: { viewCount: 1 } });
    const completed: WhatsNewModalState = applyWhatsNewModalAction(state, 'desktop', 'completed', 'first');

    expect(applyWhatsNewModalAction(completed, 'desktop', 'completed', 'second').desktop.completedAt).toBe(
      'first'
    );
  });
});

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasFeedbackRevealMilestone,
  markFeedbackRevealMilestone,
} from './initial-build-reveal-storage';

describe('initial-build-reveal-storage', function storageTests() {
  beforeEach(function clearStorage() {
    window.localStorage.clear();
  });

  it('marks and reads per app and milestone', function markRead() {
    expect(hasFeedbackRevealMilestone('app-1', 'firstFileEdit')).toBe(false);
    markFeedbackRevealMilestone('app-1', 'firstFileEdit');
    expect(hasFeedbackRevealMilestone('app-1', 'firstFileEdit')).toBe(true);
    expect(hasFeedbackRevealMilestone('app-2', 'firstFileEdit')).toBe(false);
  });

  it('dispatches appbuilder:feedback-reveal-updated', function event() {
    const handler = vi.fn();
    window.addEventListener('appbuilder:feedback-reveal-updated', handler);
    markFeedbackRevealMilestone('app-1', 'firstFileEdit');
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent<{ appId: string; milestone: string }>;
    expect(event.detail).toEqual({ appId: 'app-1', milestone: 'firstFileEdit' });
    window.removeEventListener('appbuilder:feedback-reveal-updated', handler);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JourneyTracker } from '@/lib/journeyTracker';
import { logActionEvent, logClickEvent, logImpressionEvent } from '@/utils/instrumentation';
import {
  DESIGN_KIT_EID,
  fireDesignKitAction,
  fireDesignKitClick,
  fireDesignKitImpression,
  fireDesignKitMilestone,
  fireWebsiteReadyOnce,
  resetWebsiteReadyGuard,
} from '../designKitEvents';

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
  logActionEvent: vi.fn(() => vi.fn()),
}));

const trackMilestoneSpy = vi.fn();
vi.mock('@/lib/journeyTracker', () => ({
  JourneyTracker: { current: vi.fn(() => ({ trackMilestone: trackMilestoneSpy })) },
}));

describe('designKitEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWebsiteReadyGuard();
  });

  it('every catalog eid is a valid 3-part develop.design_kit.* string', () => {
    for (const eid of Object.values(DESIGN_KIT_EID)) {
      expect(eid.split('.')).toHaveLength(3);
      expect(eid.startsWith('develop.design_kit.')).toBe(true);
    }
  });

  it('fireDesignKitClick delegates to logClickEvent with eid + props then invokes the thunk', () => {
    const thunk = vi.fn();
    vi.mocked(logClickEvent).mockReturnValue(thunk as never);
    fireDesignKitClick(DESIGN_KIT_EID.vibeApply, { kit_id: 'obsidian', kit_index: 0, option_count: 3 });
    expect(logClickEvent).toHaveBeenCalledWith(DESIGN_KIT_EID.vibeApply, {
      kit_id: 'obsidian',
      kit_index: 0,
      option_count: 3,
    });
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it('fireDesignKitImpression delegates to logImpressionEvent and invokes the thunk', () => {
    const thunk = vi.fn();
    vi.mocked(logImpressionEvent).mockReturnValue(thunk as never);
    fireDesignKitImpression(DESIGN_KIT_EID.view, { phase: 'brand', surface: 'brand_panels' });
    expect(logImpressionEvent).toHaveBeenCalledWith(DESIGN_KIT_EID.view, {
      phase: 'brand',
      surface: 'brand_panels',
    });
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it('fireDesignKitAction delegates to logActionEvent with eid/action/customProperties and invokes the thunk', () => {
    const thunk = vi.fn();
    vi.mocked(logActionEvent).mockReturnValue(thunk as never);
    fireDesignKitAction(DESIGN_KIT_EID.brandColor, 'load', {
      element: 'color',
      source: 'direct',
      trigger: 'color_input',
    });
    expect(logActionEvent).toHaveBeenCalledWith({
      eid: DESIGN_KIT_EID.brandColor,
      action: 'load',
      customProperties: { element: 'color', source: 'direct', trigger: 'color_input' },
    });
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it('fireDesignKitMilestone forwards snake_case name + props to JourneyTracker', () => {
    fireDesignKitMilestone('design_kit_vibe_selected', { kit_id: 'obsidian', kit_index: 0 });
    expect(trackMilestoneSpy).toHaveBeenCalledWith('design_kit_vibe_selected', {
      kit_id: 'obsidian',
      kit_index: 0,
    });
  });

  it('fireWebsiteReadyOnce fires an impression once per appId and suppresses repeats', () => {
    const thunk = vi.fn();
    vi.mocked(logImpressionEvent).mockReturnValue(thunk as never);
    fireWebsiteReadyOnce('app-1', { source: 'website_handoff' });
    fireWebsiteReadyOnce('app-1', { source: 'build_complete' });
    expect(logImpressionEvent).toHaveBeenCalledTimes(1);
    expect(logImpressionEvent).toHaveBeenCalledWith(DESIGN_KIT_EID.websiteReady, {
      source: 'website_handoff',
    });
  });

  it('fireWebsiteReadyOnce fires again for a different appId', () => {
    const thunk = vi.fn();
    vi.mocked(logImpressionEvent).mockReturnValue(thunk as never);
    fireWebsiteReadyOnce('app-1', { source: 'website_handoff' });
    fireWebsiteReadyOnce('app-2', { source: 'website_handoff' });
    expect(logImpressionEvent).toHaveBeenCalledTimes(2);
  });
});

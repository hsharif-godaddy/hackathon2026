/**
 * @vitest-environment jsdom
 *
 * End-to-end wiring proof: the design-kit event helpers push the exact payload a
 * REAL user emits to `window._expDataLayer` (the CSP sink) — using the REAL
 * instrumentation channel, NOT a mock. This is the observable-surface evidence
 * for AIROBUILD-2898 that stands in for the live-browser _expDataLayer walk when
 * the local stack is unavailable: it asserts the literal
 * `appbuilder.develop.design_kit.<widget>.<verb>` eid + shape CSP receives.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DESIGN_KIT_EID,
  fireDesignKitAction,
  fireDesignKitClick,
  fireDesignKitImpression,
} from '../designKitEvents';

// Clicks/actions use { data: { element, traffic:{eid,customProperties} } };
// impressions use a flatter { data: { eid, type, custom_properties } }.
interface ExpEvent {
  schema: string;
  data: {
    element?: { area: string; product: string; section: string; widget: string; action?: string };
    traffic?: { eid: string; customProperties: Record<string, unknown> };
    eid?: string;
    type?: string;
    custom_properties?: Record<string, unknown>;
  };
  targets: string[];
}

function layer(): ExpEvent[] {
  return (window as unknown as { _expDataLayer: ExpEvent[] })._expDataLayer;
}

describe('designKitEvents → _expDataLayer (real CSP channel)', () => {
  beforeEach(() => {
    (window as unknown as { _expDataLayer: ExpEvent[] })._expDataLayer = [];
  });

  it('vibe apply click pushes appbuilder.develop.design_kit.vibe_apply.click with kit props', () => {
    fireDesignKitClick(DESIGN_KIT_EID.vibeApply, { kit_id: 'obsidian', kit_index: 0, option_count: 3 });
    expect(layer()).toHaveLength(1);
    const evt = layer()[0];
    expect(evt.schema).toBe('add_click');
    expect(evt.data.traffic.eid).toBe('appbuilder.develop.design_kit.vibe_apply.click');
    expect(evt.data.element).toMatchObject({ area: 'appbuilder', product: 'develop', section: 'design_kit', widget: 'vibe_apply' });
    expect(evt.data.traffic.customProperties).toMatchObject({ kit_id: 'obsidian', kit_index: 0, option_count: 3 });
    expect(evt.targets).toContain('fullstory');
  });

  it('brand color edit pushes appbuilder.develop.design_kit.brand_color.load with source=direct', () => {
    fireDesignKitAction(DESIGN_KIT_EID.brandColor, 'load', { element: 'color', source: 'direct', trigger: 'color_input' });
    const evt = layer()[0];
    expect(evt.schema).toBe('add_element_action');
    expect(evt.data.traffic.eid).toBe('appbuilder.develop.design_kit.brand_color.load');
    expect(evt.data.element.action).toBe('load');
    expect(evt.data.traffic.customProperties).toMatchObject({ element: 'color', source: 'direct', trigger: 'color_input' });
  });

  it('page-view impression pushes appbuilder.develop.design_kit.view.impression with phase', () => {
    fireDesignKitImpression(DESIGN_KIT_EID.view, { phase: 'brand', surface: 'brand_panels' });
    const evt = layer()[0];
    expect(evt.schema).toBe('add_impression');
    expect(evt.data.eid).toBe('appbuilder.develop.design_kit.view.impression');
    expect(evt.data.custom_properties).toMatchObject({ phase: 'brand', surface: 'brand_panels' });
  });

  it('every catalog eid produces a valid impression eid — no parseEID drops', () => {
    for (const eid of Object.values(DESIGN_KIT_EID)) {
      (window as unknown as { _expDataLayer: ExpEvent[] })._expDataLayer = [];
      fireDesignKitImpression(eid);
      expect(layer(), `eid ${eid} was dropped by parseEID`).toHaveLength(1);
      expect(layer()[0].data.eid).toBe(`appbuilder.${eid}.impression`);
    }
  });
});

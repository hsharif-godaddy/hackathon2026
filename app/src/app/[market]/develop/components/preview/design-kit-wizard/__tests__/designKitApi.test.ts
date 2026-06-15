// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Break the transitive import chain: useBrandData → agent-fetch → gasket-config
// → @airo/shared/auth (not built in this workspace). We only need the constant.
// SYNC WARNING: the literal 'brand-data-updated' below must stay in sync with
// `export const BRAND_DATA_UPDATED_EVENT` in app/src/hooks/useBrandData.ts.
// If that constant's value changes, update this mock to match.
vi.mock('@/hooks/useBrandData', () => ({
  BRAND_DATA_UPDATED_EVENT: 'brand-data-updated',
}));

import { BRAND_DATA_UPDATED_EVENT } from '@/hooks/useBrandData';
import { designKitApi } from '../designKitApi';

describe('designKitApi', () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));

  beforeEach(() => {
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches BRAND_DATA_UPDATED_EVENT with the appId after a successful edit', async () => {
    const handler = vi.fn();
    window.addEventListener(BRAND_DATA_UPDATED_EVENT, handler);

    await designKitApi.setColors('app1234567', 'Indigo', { primary: '#3b5bdb', background: '#ffffff' });

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent<{ appId: string }>;
    expect(event.detail.appId).toBe('app1234567');

    window.removeEventListener(BRAND_DATA_UPDATED_EVENT, handler);
  });

  it('on a non-ok response: resolves (does not throw), logs, and dispatches the event to roll back', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn();
    window.addEventListener(BRAND_DATA_UPDATED_EVENT, handler);

    // Must resolve, not reject — `void designKitApi.*` call sites would otherwise
    // produce an unhandled rejection.
    await expect(
      designKitApi.setImagery('app1234567', 'minimal'),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith('designKit.save.failed', expect.objectContaining({ appId: 'app1234567', status: 500 }));
    // Refetch fires so every useBrandData consumer reverts to the persisted value.
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0]![0] as CustomEvent<{ appId: string }>).detail.appId).toBe('app1234567');

    window.removeEventListener(BRAND_DATA_UPDATED_EVENT, handler);
    errorSpy.mockRestore();
  });

  it('on a fetch rejection: resolves (does not throw), logs, and dispatches the event to roll back', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn();
    window.addEventListener(BRAND_DATA_UPDATED_EVENT, handler);

    await expect(
      designKitApi.setVoice('app1234567', { weAre: ['Calm'] }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith('designKit.save.failed', expect.objectContaining({ appId: 'app1234567' }));
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener(BRAND_DATA_UPDATED_EVENT, handler);
    errorSpy.mockRestore();
  });
});

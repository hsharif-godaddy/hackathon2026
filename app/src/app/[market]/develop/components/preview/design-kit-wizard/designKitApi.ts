/**
 * Thin client for the Design Kit Wizard BFF proxy (`PUT /api/design-kit/:appId/:action`).
 *
 * Each call forwards to the agents direct-edit route, which persists the edit
 * (reusing the same write functions the agent tools use) without an agent turn.
 * Live preview is the caller's responsibility (postMessage helpers).
 */
import { BRAND_DATA_UPDATED_EVENT } from '@/hooks/useBrandData';

export interface FontChoice {
  name: string;
  weights: string[];
  category: string;
}

/** Tell every useBrandData consumer (BrandBookView, AssemblingKit, the summary /
 *  elements panels) to refetch. On success this reflects the persisted edit; on
 *  failure it reverts the caller's optimistic local state back to the unchanged
 *  persisted value (a rollback) — direct edits bypass the agent tool_result path
 *  that normally fires this event. */
function dispatchBrandDataUpdated(appId: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BRAND_DATA_UPDATED_EVENT, { detail: { appId } }));
  }
}

/**
 * Fire a direct-edit PUT. Callers update local state / the live preview
 * optimistically and call this fire-and-forget (`void designKitApi.*`), so this
 * MUST always resolve — never reject — or those `void` calls produce unhandled
 * promise rejections. On a network error OR a non-2xx response we log and
 * dispatch BRAND_DATA_UPDATED_EVENT to roll the optimistic UI back to the
 * persisted (unchanged) value, since there is no clean non-hook toast utility in
 * this package to surface a user-facing error from a plain module.
 */
async function put(appId: string, action: string, body: unknown): Promise<void> {
  try {
    const res = await fetch(`/api/design-kit/${appId}/${action}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('designKit.save.failed', { appId, action, status: res.status });
      dispatchBrandDataUpdated(appId); // rollback: refetch persisted value
      return;
    }
    dispatchBrandDataUpdated(appId);
  } catch (err) {
    console.error('designKit.save.failed', { appId, action, error: err });
    dispatchBrandDataUpdated(appId); // rollback: refetch persisted value
  }
}

export const designKitApi = {
  setColors: (appId: string, name: string, palette: Record<string, string>): Promise<void> =>
    put(appId, 'colors', { name, palette }),
  setFonts: (appId: string, heading: FontChoice, body: FontChoice): Promise<void> =>
    put(appId, 'fonts', { heading, body }),
  setVoice: (
    appId: string,
    voice: { weAre?: string[]; weAreNot?: string[] },
  ): Promise<void> => put(appId, 'voice', { voice }),
  setSummary: (appId: string, text: string): Promise<void> => put(appId, 'summary', { text }),
  setImagery: (appId: string, keyword: string): Promise<void> =>
    put(appId, 'imagery', { keyword }),
};

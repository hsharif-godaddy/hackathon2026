import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Persist + broadcast a design-kit wizard phase via the real BFF proxy
 * (authenticated by the shared SSO cookie on `page.request`). The agents route
 * persists `designKitLayoutForPhase(true, phase)` to app metadata and emits the
 * `builder_layout` SSE, so a reload resolves the layout from `GET /apps/:id`.
 * Retries with backoff (condition-based via `toPass` — no `waitForTimeout`, per
 * the tests/ eslint guardrail) since the app's agent allocation (`site.agent_url`)
 * can lag a beat right after create. Throws (fails the test) if the endpoint never
 * returns 2xx within the budget.
 */
export async function driveWizardPhase(
  page: Page,
  appId: string,
  phase: 'gathering' | 'brand' | 'website' | 'ready',
): Promise<void> {
  await expect(async () => {
    const res = await page.request.put(`/api/design-kit/${appId}/wizard-step`, { data: { phase } });
    expect(res.ok(), `wizard-step ${phase} -> HTTP ${res.status()}`).toBeTruthy();
  }).toPass({ timeout: 20_000, intervals: [1_000, 2_000, 3_000, 5_000] });
}

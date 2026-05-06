import type { DiagnoseRequest, DiagnoseResponse } from './types.js';

/**
 * Product-neutral diagnose contract.
 *
 * Takes a DiagnoseRequest (appId + target) and returns a structured Analysis of
 * the app's recent logs. Implementations may differ in how they classify
 * failures (pattern tier, LLM tier, future tiers) and which domain-specific
 * prompts or rule bundles they load.
 *
 * Current implementations:
 *   - PaaSDiagnoseService (Node.js Hosting) — the only implementation today.
 *
 * Future product variants (e.g. AAB) should add their own implementation of
 * this interface so the HTTP route and other consumers can stay product-neutral.
 */
export interface DiagnoseService {
  diagnose(request: DiagnoseRequest): Promise<DiagnoseResponse>;
}

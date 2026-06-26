import type { SiteInfo } from '@/lib/control-plane/types';

/**
 * Resolves the base URL of the agents service for a given site.
 *
 * Precedence:
 *   1. `site.agent_url` — the per-app URL the control plane sets when the app
 *      is provisioned. This is the only value that's correct in production
 *      (each app gets its own agents instance).
 *   2. `AGENTS_SERVICE_URL` — env override, useful for local dev or tests when
 *      a `site` object exists but its `agent_url` is missing.
 *   3. `http://localhost:${AGENTS_PORT|4000}` — last-resort fallback when
 *      neither a site nor an env override is available. Honors `AGENTS_PORT`
 *      to match the env knob the agents server, the local-control-plane, and
 *      the gosym-probe eval all read. The host/scheme are preserved from the
 *      original inline fallback so local setups that depended on
 *      `http://localhost:4000` still work — only the port portion is
 *      override-able. For HTTPS / non-localhost hosts, set
 *      `AGENTS_SERVICE_URL` explicitly.
 *
 * Why a helper: three BFF routes previously inlined the fallback chain and
 * hardcoded `http://localhost:4000`, so the local-dev port override worked
 * through the control-plane path but broke the moment `site.agent_url` was
 * missing.
 */
export function resolveAgentsBaseUrl(site?: Pick<SiteInfo, 'agent_url'> | null): string {
  if (site?.agent_url) {
    return site.agent_url;
  }
  const envOverride: string | undefined = process.env.AGENTS_SERVICE_URL;
  if (envOverride) {
    return envOverride;
  }
  const port: string = process.env.AGENTS_PORT?.trim() || '4000';
  return `http://localhost:${port}`;
}

import { logger } from '@/lib/request-context';
import gasket from '../../../gasket.ts';

const FALLBACK_DOMAIN = 'test-airoapp.ai';

// Mirrors the URL pattern from V2ControlPlaneAdapter.constructUrls (private to that
// adapter), so changes to the preview hostname format must be kept in sync there:
// app/src/lib/control-plane/v2-control-plane-adapter.ts (constructUrls)
export function buildPreviewUrl(siteId: string, cellPrefix: string): string {
  // Optional chain: if `gasket` or `gasket.config` is undefined (module load
  // ordering, partial test bootstrap, etc.), fall through to the configured
  // fallback path with a warn rather than throwing an unhandled TypeError
  // that propagates out of the Server Component as an unlogged 500.
  const configuredDomain = (gasket?.config as { airoAppDomain?: string } | undefined)?.airoAppDomain;

  if (!configuredDomain) {
    // Misconfiguration in production would silently route every share link to
    // the test domain. Log a warn so the issue is visible in operational logs.
    // Include siteId + cellPrefix so individual broken redirects can be
    // correlated with downstream traces.
    logger.warn('share.buildPreviewUrl.airoAppDomainFallback', {
      fallback: FALLBACK_DOMAIN,
      siteId,
      cellPrefix,
    });
  }

  const baseDomain = configuredDomain || FALLBACK_DOMAIN;
  return `https://${siteId}.preview.${cellPrefix}.${baseDomain}`;
}

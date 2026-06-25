'use client';

import { useMemo, useState } from 'react';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton';
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useAppSsoStatus } from '@/hooks/useAppSsoStatus';
import { useTranslations } from '@/hooks/useTranslations';
import { DomainStatus, type SiteDomain } from '@/lib/control-plane/types';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

const IDP_CALLBACK_PATH: string = '/airo/idp/callback';

/**
 * Resolve every host the customer must register at their IdP as a redirect
 * URI. dev-supervisor derives `redirect_uri` per request from the inbound
 * `Host` header (mhp-core §3.5.1), so EACH host that serves the published
 * app — the cell-default app URL and any attached custom domains — must
 * appear in the IdP's allow-list, otherwise that host's OAuth round-trip
 * fails with `redirect_uri_mismatch`.
 *
 * Source-of-truth ordering:
 *   1. `site.domains[]` — every active FQDN (prefix + custom). When mgmt-
 *      hosting has provisioned the prefix domain, it appears here alongside
 *      any custom domains the customer attached.
 *   2. `site.published_url` host — backstop used during early provisioning,
 *      before mgmt-hosting has populated `domains[]`. Optimistic URL
 *      construction in the adapter guarantees this is set as soon as the
 *      app exists, so the panel never has to show a `<host>` placeholder
 *      on a real app.
 *
 * Pending / inactive / failed domains are excluded — registering them
 * would only confuse customers since they're not serving traffic yet.
 */
function resolveSsoRedirectHosts(
  domains: SiteDomain[] | undefined,
  publishedURL: string | undefined,
): string[] {
  const hosts: Set<string> = new Set<string>();
  for (const d of domains ?? []) {
    if (d.status === DomainStatus.ACTIVE && d.fqdn) {
      hosts.add(d.fqdn);
    }
  }
  if (hosts.size === 0 && publishedURL) {
    try {
      const parsed: URL = new URL(publishedURL);
      if (parsed.hostname) hosts.add(parsed.hostname);
    } catch {
      // Malformed URL on the site object — fall through; the UI will show
      // the literal `<host>` placeholder so the customer at least sees the
      // pattern they need to construct manually.
    }
  }
  return Array.from(hosts).sort();
}

/**
 * Settings → SSO panel — Phase-1 + Phase-2 (customer override).
 *
 * Phase-1: when the admin tier on the bound SSO config is `'true'` (hard-
 * locked on), the panel shows a locked info alert and the credentials
 * form. The customer must save Client ID + Client Secret before publish.
 *
 * Phase-2: when the admin tier is `'optional'` (`ssoOverrideAllowed:true`),
 * the panel shows a customer-facing checkbox at the top. Toggling it ON
 * calls `PUT /api/apps/[id]/sso-required` with `{ssoRequired:true}`. Once
 * ON, the credentials form appears (same as Phase-1). Toggling OFF clears
 * the per-app override → SSO disabled for this app.
 *
 * Visibility matrix:
 *   - ssoOverrideAllowed=false, ssoRequired=true   → locked alert + form
 *   - ssoOverrideAllowed=false, ssoRequired=false  → panel hidden
 *   - ssoOverrideAllowed=true,  ssoRequired=true   → toggle (on) + form
 *   - ssoOverrideAllowed=true,  ssoRequired=false  → toggle (off), no form
 *
 * Issuer URL, JWKS, expected audience, OIDC discovery — all admin-managed
 * in `airo_enterprise_sso_configs`. Customers only own the bare credentials
 * issued by their IdP. The credentials write hits airo-go's customer-proxy
 * (mhp-core PR #738) as two `auth`-class pointer rows; airo-go forwards to
 * hosting with the customer's gd-auth JWT. The pointer names are read per-
 * config from `SiteInfo.clientIdSecretName` / `clientSecretSecretName`
 * (see `app/src/lib/sso/pointer-names.ts` for the resolver + defaults).
 */
export default function SsoPanel() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const sso = useAppSsoStatus(appId);
  const patchSiteSsoFields = useDevelopPageStore((s) => s.patchSiteSsoFields);
  // Pull domains + published_url straight from the develop-page store; the
  // SSO status hook only exposes SSO-specific fields, but the redirect-URI
  // surface needs the host inventory.
  const siteDomains: SiteDomain[] | undefined = useDevelopPageStore((s) => s.site?.domains);
  const sitePublishedURL: string | undefined = useDevelopPageStore((s) => s.site?.published_url);
  const redirectHosts: string[] = useMemo(
    () => resolveSsoRedirectHosts(siteDomains, sitePublishedURL),
    [siteDomains, sitePublishedURL],
  );

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingOverride, setIsTogglingOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (sso.isLoading) {
    return <PanelSkeleton />;
  }
  // Hide entirely when SSO is not in play for this app AND the admin tier
  // doesn't permit the customer to enable it. (The other three cases all
  // need some surface — locked indicator, toggle off, or toggle on + form.)
  if (!sso.ssoRequired && !sso.ssoOverrideAllowed) {
    return null;
  }

  const handleToggleOverride = async (nextEnabled: boolean) => {
    if (!appId) return;
    setError(null);
    setSuccess(null);
    setIsTogglingOverride(true);
    try {
      const res = await fetch(`/api/apps/${appId}/sso-required`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ssoRequired: nextEnabled }),
      });
      if (!res.ok) {
        let body: { error?: string } | null = null;
        try { body = await res.json() as { error?: string }; } catch { /* non-JSON */ }
        if (res.status === 409 && body?.error === 'sso_toggle_locked') {
          setError(t('builder_sso_toggle_error_locked'));
          return;
        }
        throw new Error(body?.error || `Toggle failed: ${res.status}`);
      }
      const data = await res.json() as {
        ssoRequired: boolean;
        ssoRequiredOverride: boolean | null;
        ssoOverrideAllowed: boolean;
      };
      // Propagate the server-authoritative response into the develop store
      // so every other consumer (publish button, share link, SSO panel
      // itself) sees the new gate state without a page reload.
      patchSiteSsoFields({
        ssoRequired: data.ssoRequired,
        ssoRequiredOverride: data.ssoRequiredOverride,
        ssoOverrideAllowed: data.ssoOverrideAllowed,
      });
      // Re-fetch credential presence on the next render — toggling OFF
      // doesn't delete credentials, but the gates downstream may key off
      // the resolved boolean changing.
      sso.refresh();
    } catch (err) {
      logger.error('SsoPanel.toggle-failed', { error: String(err) });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTogglingOverride(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!appId) return;
    if (!sso.ssoConfigId) {
      logger.error('SsoPanel.save-blocked.missing-config-id', { appId });
      setError(t('builder_sso_form_error_missing_config_id'));
      return;
    }
    if (!clientId.trim() || !clientSecret.trim()) {
      setError(t('builder_sso_form_error_required_fields'));
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/apps/${appId}/sso-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          client_id: clientId.trim(),
          client_secret: clientSecret,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Save failed: ${res.status}`);
      }
      setClientSecret(''); // never echo the secret back
      setSuccess(t('builder_sso_status_configured'));
      sso.refresh();
    } catch (err) {
      logger.error('SsoPanel.save-failed', { error: String(err) });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  // The credentials form renders when SSO is required for this app — either
  // admin-locked on, or customer has toggled the override on.
  const showCredentialsForm = sso.ssoRequired;

  return (
    <SettingsSection title={t('builder_sso_panel_title')}>
      <Box gap="lg">
        {sso.ssoOverrideAllowed ? (
          <Box gap="sm" data-testid="sso-policy-block">
            <Checkbox
              id="sso-override-toggle"
              name="sso-override-toggle"
              data-testid="sso-override-toggle"
              checked={sso.ssoRequired}
              disabled={isTogglingOverride}
              onChange={(checked: boolean) => handleToggleOverride(checked)}
              label={t('builder_sso_override_toggle_label')}
            />
            <text.p className="text-sm">
              {t('builder_sso_override_toggle_help')}
            </text.p>
          </Box>
        ) : (
          <Box gap="sm" data-testid="sso-policy-block">
            <Alert
              emphasis="info"
              title={t('builder_sso_toggle_locked_note')}
            />
          </Box>
        )}

        {showCredentialsForm && (
          <form onSubmit={handleSubmit} noValidate>
            <Box gap="md">
              <Box gap="sm">
                <text.p className="font-semibold">
                  {t('builder_sso_form_intro_heading')}
                </text.p>
                <ol className="list-decimal ps-5 space-y-1 text-sm">
                  <li>{t('builder_sso_form_intro_step1')}</li>
                  <li>{t('builder_sso_form_intro_step2')}</li>
                </ol>
              </Box>

              {/* Redirect-URI guidance — dev-supervisor derives the URI per
                  request from the inbound Host header (mhp-core §3.5.1), so
                  the customer must register the concrete `https://<host>/
                  airo/idp/callback` URL at their IdP for every host that
                  should accept SSO. We render the actual hosts (the cell-
                  default app URL + any active custom domains) so the
                  customer can copy-paste exactly what their IdP expects —
                  the previous `<host>` placeholder created a chicken-and-
                  egg problem since SSO is a publish prerequisite and the
                  customer needs the precise redirect URI to register at
                  the IdP. The `hosts_note` covers the future case where
                  they attach more custom domains.

                  `text-sm` on the inline `<code>` overrides the browser
                  UA default (font-size: medium ≈ 16px) so the URIs don't
                  render larger than the surrounding 14px copy. `break-all`
                  prevents long custom domains from overflowing the panel. */}
              <Box gap="sm" data-testid="sso-redirect-uri-guidance">
                <text.p className="font-semibold text-sm">
                  {t('builder_sso_form_redirect_uri_heading')}
                </text.p>
                <text.p className="text-sm">
                  {t('builder_sso_form_redirect_uri_pattern')}
                </text.p>
                <ul className="list-disc ps-5 space-y-1 text-sm" data-testid="sso-redirect-uri-list">
                  {redirectHosts.length === 0 ? (
                    <li>
                      <code className="font-mono text-sm break-all">
                        https://&lt;host&gt;{IDP_CALLBACK_PATH}
                      </code>
                    </li>
                  ) : (
                    redirectHosts.map((host: string) => (
                      <li key={host}>
                        <code className="font-mono text-sm break-all" data-testid="sso-redirect-uri">
                          https://{host}{IDP_CALLBACK_PATH}
                        </code>
                      </li>
                    ))
                  )}
                </ul>
                <text.p className="text-sm">
                  {t('builder_sso_form_redirect_uri_hosts_note')}
                </text.p>
                {/* Admin-access fallback. Many enterprise customers are not
                    themselves Okta administrators; they have an internal
                    identity team that owns OAuth app registrations. Surface
                    the path forward up-front so the customer doesn't get
                    stuck trying to add the redirect URI in an Okta console
                    they don't have access to. Distinct paragraph (not a
                    bullet under the redirect-URI list) because it's a
                    handoff instruction, not part of the URI itself. */}
                <text.p className="text-sm">
                  {t('builder_sso_form_admin_access_note')}
                </text.p>
              </Box>

              <TextInput
                id="sso-client-id"
                label={t('builder_sso_form_client_id_label')}
                value={clientId}
                onChange={(value: string) => setClientId(value)}
                disabled={isSaving}
                data-testid="sso-client-id"
              />

              <TextInput
                id="sso-client-secret"
                label={t('builder_sso_form_client_secret_label')}
                type="password"
                value={clientSecret}
                onChange={(value: string) => setClientSecret(value)}
                placeholder={sso.ssoConfigured ? '••••••••' : ''}
                disabled={isSaving}
                data-testid="sso-client-secret"
              />

              {error && (
                <Alert emphasis="critical" data-testid="sso-error" title={error} />
              )}
              {success && (
                <Alert emphasis="success" data-testid="sso-success" title={success} />
              )}

              <Box orientation="horizontal" gap="sm" blockAlignChildren="start">
                <Button
                  type="submit"
                  design="primary"
                  disabled={isSaving}
                  data-testid="sso-save"
                  icon={isSaving ? <Spinner size="sm" /> : undefined}
                  text={isSaving ? t('builder_sso_form_saving') : t('builder_common_save')}
                />
                {sso.ssoConfigured && !success && (
                  <text.p>
                    {t('builder_sso_status_configured')}
                  </text.p>
                )}
              </Box>
            </Box>
          </form>
        )}
        {!showCredentialsForm && error && (
          // Toggle-only errors (e.g. lock conflict from server)
          <Alert emphasis="critical" data-testid="sso-error" title={error} />
        )}
      </Box>
    </SettingsSection>
  );
}

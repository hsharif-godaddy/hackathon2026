'use client';

import type { ReactElement } from 'react';
import Alert from '@ux/alert';

import { useTranslations } from '@/hooks/useTranslations';

interface EnterpriseUpgradeNoticeProps {
  /**
   * Optional `data-testid` for the rendered alert. Defaults to
   * `enterprise-upgrade-notice` if not provided. Callers that surface
   * this notice in more than one place on the same screen should pass a
   * disambiguating id so Playwright / RTL queries can pick the right one.
   */
  testId?: string;
  /**
   * Tailwind className passed through to the wrapping element. Allows
   * call sites to control surrounding spacing without re-styling the
   * Alert itself.
   */
  className?: string;
}

/**
 * Inline replacement for upgrade buttons / banners when the active site
 * is on an enterprise-managed plan (`ownerProduct === 'aab-ent-v1'`).
 * The enterprise admin owns the subscription, so the end-user customer
 * cannot self-serve an upgrade — the previous CTA would dead-end at a
 * paywall they have no permission to clear. This message gives them the
 * right next step.
 *
 * Render this in place of `<Button text={t('builder_upgrade_button')} />`
 * (or equivalent) when `useEnterpriseManaged().isEnterpriseManaged` is
 * true. Same visual footprint as a typical inline Alert so the surrounding
 * layout doesn't shift.
 */
export function EnterpriseUpgradeNotice({ testId, className }: EnterpriseUpgradeNoticeProps): ReactElement {
  const t = useTranslations();
  return (
    <div className={className} data-testid={testId ?? 'enterprise-upgrade-notice'}>
      <Alert
        emphasis="info"
        title={t('builder_enterprise_upgrade_managed_note')}
      />
    </div>
  );
}

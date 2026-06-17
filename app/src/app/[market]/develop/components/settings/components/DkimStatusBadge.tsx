'use client';

import { useEffect, useRef } from 'react';
import Tag from '@ux/tag';

import { useDkimStatusQuery } from '@/hooks/useDkimStatusQuery';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { logImpressionEvent } from '@/utils/instrumentation';

interface DkimStatusBadgeProps {
  appId: string;
  domain: string;
}

// i18n keys consumed below. These must be registered at
// https://i18n.int.gdcorp.tools/org/hcx/app/aab (PARTNERSTRANSLATIONS AD
// group) BEFORE this component ships to the locale build pipeline. The
// English text in the registration request:
//
//   builder_dkim_status_active        → "DKIM active"
//   builder_dkim_status_pending       → "DKIM pending"
//   builder_dkim_status_unavailable   → "DKIM unknown"
//
// Until the keys are registered, useTranslations falls back to the key
// string itself, which is non-translated but at least obvious in the
// UI that something is missing — preferable to shipping hardcoded
// English to all 62 locales.
export function DkimStatusBadge({ appId, domain }: DkimStatusBadgeProps) {
  const t = useTranslations();
  // Strict gate: when appbuilder-dkim-onboarding is OFF (or undefined,
  // e.g. during SSR before hydration), the badge does not render and
  // does not poll. Passing nulls into useDkimStatusQuery disables the
  // underlying useQuery — no network traffic, no React Query state.
  // Self-gating here means callers (DomainItem, DomainToolRenderer)
  // don't each have to remember the flag name.
  const dkimUiEnabled = useSwitchboard('appbuilder-dkim-onboarding') === true;
  const { data, isLoading, isError } = useDkimStatusQuery(
    dkimUiEnabled ? appId : null,
    dkimUiEnabled ? domain : null,
  );

  // Fire a CSP impression once per (domain, dkim-state) so FullStory/Signals
  // sees the badge state. Placed before the early returns to satisfy the
  // rules-of-hooks; guarded internally on flag + loading.
  const trackedStateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dkimUiEnabled || isLoading) return;
    const state = (isError || !data) ? 'unavailable' : data.dkimValid ? 'active' : 'pending';
    const key = `${domain}:${state}`;
    if (trackedStateRef.current === key) return;
    trackedStateRef.current = key;
    if (state === 'active') logImpressionEvent('settings.domains.dkim_active')();
    else if (state === 'pending') logImpressionEvent('settings.domains.dkim_pending')();
    else logImpressionEvent('settings.domains.dkim_unavailable')();
  }, [dkimUiEnabled, isLoading, isError, data, domain]);

  if (!dkimUiEnabled) {
    return null;
  }

  if (isLoading) {
    return null;
  }

  if (isError || !data) {
    return (
      <Tag>
        {t('builder_dkim_status_unavailable')}
      </Tag>
    );
  }

  if (data.dkimValid) {
    return (
      <Tag emphasis="success">
        {t('builder_dkim_status_active')}
      </Tag>
    );
  }

  return (
    <Tag emphasis="warning">
      {t('builder_dkim_status_pending')}
    </Tag>
  );
}

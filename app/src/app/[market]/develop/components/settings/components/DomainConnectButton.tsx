'use client';

import { useEffect, useState } from 'react';
import Button from '@ux/button';

import { useTranslations } from '@/hooks/useTranslations';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import type { DomainConnectProvider } from '@/utils/domain';
import { generateClickEID, logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

interface DomainConnectButtonProps {
  appId: string;
  fqdn: string;
  anycastIp: string;
  dcv: string;
  provider: DomainConnectProvider;
  onError: () => void;
  isConnecting?: boolean;
  dkimSuffix?: string;
}

/**
 * Fetches the signed Domain Connect URL from the BFF and redirects the user
 * to the DNS provider's consent flow. On failure, calls onError() so the
 * parent can fall back to showing manual DNS instructions.
 */
export default function DomainConnectButton({
  appId,
  fqdn,
  anycastIp,
  dcv,
  provider,
  onError,
  isConnecting = false,
  dkimSuffix,
}: DomainConnectButtonProps) {
  const t = useTranslations();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const isBusy: boolean = isLoading || isConnecting;

  useEffect(function trackButtonImpression() {
    logImpressionEvent('settings.domains.connect_automatic')();
  }, []);

  async function handleClick(): Promise<void> {
    logClickEvent('settings.domains.connect_automatic')();
    setIsLoading(true);
    try {
      const rawParams: Record<string, string> = { fqdn, v1: anycastIp, dcv };
      if (dkimSuffix) rawParams.dkimSuffix = dkimSuffix;
      const params: URLSearchParams = new URLSearchParams(rawParams);
      const response: Response = await appFetch(
        `/api/apps/${appId}/domain-connect/${provider}/url?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(`url-route returned ${response.status}`);
      }
      const data: { url?: unknown } = (await response.json()) as { url?: unknown };
      if (typeof data?.url !== 'string') {
        throw new Error('url-route returned unexpected response shape');
      }
      window.location.href = data.url;
    } catch (err: unknown) {
      logger.error('domain-connect.button.fetch-failed', {
        message: 'Failed to fetch Domain Connect URL',
        appId,
        fqdn,
        provider,
        error: err instanceof Error ? err.message : String(err),
      });
      setIsLoading(false);
      onError();
    }
  }

  return (
    <Button
      text={
        isBusy
          ? t('builder_domain_attach_connecting')
          : t('builder_domain_connect_automatic_button', undefined, 'Connect DNS automatically')
      }
      design="primary"
      size="sm"
      disabled={isBusy}
      onClick={() => void handleClick()}
      data-eid={generateClickEID('settings.domains.connect_automatic')}
    />
  );
}

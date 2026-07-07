import { useEffect } from 'react';

import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logImpressionEvent } from '@/utils/instrumentation';

type SearchParamsLike = { get: (key: string) => string | null } | null | undefined;

export function useDomainConnectCallbackConsumer(
  searchParams: SearchParamsLike,
  appId: string | null | undefined,
): void {
  useEffect(
    function consumeDomainConnectCallbackParams() {
      const status: string | null = searchParams?.get('domainConnect') ?? null;
      if (!status || !appId) return;
      const result: 'success' | 'error' = status === 'success' ? 'success' : 'error';
      useDevelopPageStore.getState().setDomainConnectCallbackResult(result);
      if (result === 'success') {
        useDevelopPageStore.getState().setDomainConnectSucceeded(appId, true);
        logImpressionEvent('settings.domains.connect_automatic_success')();
      } else {
        logImpressionEvent('settings.domains.connect_automatic_error')();
      }
      const url: URL = new URL(window.location.href);
      url.searchParams.delete('domainConnect');
      url.searchParams.delete('domain');
      window.history.replaceState({}, '', url);
    },
    [searchParams, appId],
  );
}

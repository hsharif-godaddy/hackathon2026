import type { PropsWithChildren } from 'react';
import { GoDaddyProvider } from '@godaddy/react';
import { useQueryClient } from '@tanstack/react-query';
import { getStorefrontRuntimeConfig } from '../../lib/commerce/storefront-config';

export function StorefrontProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const config = getStorefrontRuntimeConfig();

  return (
    <GoDaddyProvider
      queryClient={queryClient}
      storeId={config.storeId}
      channelId={config.channelId}
      clientId={config.clientId}
      apiHost={config.apiHost}
    >
      {children}
    </GoDaddyProvider>
  );
}

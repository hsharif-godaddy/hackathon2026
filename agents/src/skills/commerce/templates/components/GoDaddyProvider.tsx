'use client';
import { type ReactNode } from 'react';
import { GoDaddyProvider as Provider } from '@godaddy/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hoisted to module scope so the QueryClient is created once for the lifetime
// of the app. Creating it inside the component (even with useMemo) causes it
// to be recreated on remount or HMR, which drops the draft-order cache and
// makes "Add to Cart" fail with "Order not found".
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

const clientId = import.meta.env.VITE_GODADDY_CLIENT_ID as string;
const apiHost = import.meta.env.VITE_GODADDY_API_HOST as string;
const storeId = import.meta.env.VITE_GODADDY_STORE_ID as string;
const channelId = import.meta.env.VITE_GODADDY_CHANNEL_ID as string;

export function GoDaddyCommerceProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <Provider
        queryClient={queryClient}
        storeId={storeId}
        clientId={clientId}
        channelId={channelId}
        apiHost={apiHost}
      >
        {children}
      </Provider>
    </QueryClientProvider>
  );
}

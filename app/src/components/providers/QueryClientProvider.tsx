'use client';

import { ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider as TanstackQueryClientProvider } from '@tanstack/react-query';

/**
 * Global QueryClient instance that can be accessed outside of React components
 * This is initialized when the provider mounts
 */
let globalQueryClient: QueryClient | null = null;

/**
 * Get the global QueryClient instance
 * Returns null if called before the provider has mounted
 */
export function getQueryClient(): QueryClient | null {
  return globalQueryClient;
}

export function QueryClientProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => {
      const client = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      });

      // Store as global instance for non-React access
      globalQueryClient = client;

      return client;
    }
  );

  return (
    <TanstackQueryClientProvider client={queryClient}>
      {children}
    </TanstackQueryClientProvider>
  );
}

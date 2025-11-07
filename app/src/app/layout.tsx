import type { Metadata } from "next";
import { withGasketData } from '@gasket/nextjs/layout';
import { makeLayout } from '@godaddy/gasket-next/layout';
import { QueryClientProvider } from "@/providers/QueryClientProvider";
import AuthProvider from "@/components/providers/AuthProvider";
import FullStoryProvider from "@/components/providers/FullStoryProvider";
import RumProvider from "@/components/providers/RumProvider";
import SubscriptionCacheProvider from "@/components/providers/SubscriptionCacheProvider";
import FrameBuster from "@/components/security/FrameBuster";

import "@/styles/globals.scss";

import gasket from '../../gasket';

export const metadata: Metadata = {
  title: "Airo App Builder",
  description: "Airo App Builder",
};

const PresentationLayout = withGasketData(gasket)(makeLayout(gasket));

async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <PresentationLayout>
      <FrameBuster />
      <RumProvider>
        <FullStoryProvider>
          <AuthProvider>
            <QueryClientProvider>
              <SubscriptionCacheProvider>
                <main className="flex-1 min-h-screen">
                  {children}
                </main>
              </SubscriptionCacheProvider>
            </QueryClientProvider>
          </AuthProvider>
        </FullStoryProvider>
      </RumProvider>
    </PresentationLayout>
  )
}

export default RootLayout;

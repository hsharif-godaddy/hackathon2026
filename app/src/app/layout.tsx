import type { Metadata } from "next";
import { Suspense } from "react";
import { withGasketData } from '@gasket/nextjs/layout';
import { makeLayout } from '@godaddy/gasket-next/layout';
import { QueryClientProvider } from "@/components/providers/QueryClientProvider";
import AuthProvider from "@/components/providers/AuthProvider";
import FullStoryProvider from "@/components/providers/FullStoryProvider";
import RumProvider from "@/components/providers/RumProvider";
import SubscriptionCacheProvider from "@/components/providers/SubscriptionCacheProvider";
import FrameBuster from "@/components/security/FrameBuster";
import ConversationIdCookie from "@/components/security/ConversationIdCookie";
import { TranslationsProvider } from "@/components/providers/TranslationProvider";
import { fetchTranslationPackages, getServerIntl, detectLocale } from "@/lib/translations";

import "@/styles/globals.scss";

import gasket from '../../gasket';

/**
 * Generate metadata dynamically based on user's locale
 * 
 * **Behavior by scenario:**
 * - Authenticated + translation exists: Localized metadata
 * - Unauthenticated (incognito, logged out): English defaults
 * 
 * @returns Promise resolving to Metadata object with title and description
 */
export async function generateMetadata(): Promise<Metadata> {
  const defaultTitle = 'Airo App Builder';
  const defaultDescription = 'Build and manage your website with AI-powered tools';
  try {
    const locale = await detectLocale();
    const intl = await getServerIntl({ locale });
    
    let title = defaultTitle;
    let description = defaultDescription;
    
    // TODO: handle translations for unauthenticated users
    title = intl.formatMessage({ id: 'builder_title', defaultMessage: defaultTitle });
    description = intl.formatMessage({ id: 'builder_description', defaultMessage: defaultDescription });

    return {
      title: title || defaultTitle,
      description: description || defaultDescription,
    };
  } catch (error) {
    return {
      title: defaultTitle,
      description: defaultDescription,
    };
  }
}

const PresentationLayout = withGasketData(gasket)(makeLayout(gasket));

/**
 * Root layout component for the application
 * 
 * **Translation Handling:**
 * - Fetches translations on server-side for initial page load
 * - Always attempts fetch (works in incognito, logged out, etc.)
 * - Returns empty `{}` if BFF returns 401 (unauthenticated)
 * - TranslationsProvider gracefully falls back to English for empty messages
 * 
 * This ensures all pages work regardless of auth state.
 */
async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await detectLocale();
  const messages = await fetchTranslationPackages(['@airo/app-builder'], {
    credentials: 'include',
    cache: 'force-cache',
  });
  
  return (
    <PresentationLayout>
      <FrameBuster />
      <Suspense fallback={null}>
        <ConversationIdCookie />
      </Suspense>
      <RumProvider>
        <FullStoryProvider>
        <QueryClientProvider>
          <TranslationsProvider 
            locale={ locale }
            messages={ messages }
          >
            <AuthProvider>
              <SubscriptionCacheProvider>
                <main className="flex-1 min-h-screen">
                  {children}
                </main>
              </SubscriptionCacheProvider>
            </AuthProvider>
          </TranslationsProvider>
          </QueryClientProvider>
        </FullStoryProvider>
      </RumProvider>
    </PresentationLayout>
  )
}

export default RootLayout;

import "@/styles/globals.scss";

import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { withGasketData } from '@gasket/nextjs/layout';
import { makeLayout } from '@godaddy/gasket-next/layout';

import GlobalSsoLogin from "@/components/auth/GlobalSsoLogin";
import SessionTimeoutManager from "@/components/auth/SessionTimeoutManager";
import AuthProvider from "@/components/providers/AuthProvider";
import FullStoryProvider from "@/components/providers/FullStoryProvider";
import { QueryClientProvider } from "@/components/providers/QueryClientProvider";
import RumProvider from "@/components/providers/RumProvider";
import SubscriptionCacheProvider from "@/components/providers/SubscriptionCacheProvider";
import { TranslationsProvider } from "@/components/providers/TranslationProvider";
import ConversationIdCookie from "@/components/security/ConversationIdCookie";
import FrameBuster from "@/components/security/FrameBuster";
import ReferralTracker from "@/components/tracking/ReferralTracker";
import { logger } from "@/lib/request-context";
import { detectLocale, getServerIntl } from "@/lib/translations";
import { loadTranslations } from "@/lib/translations/load-translations";
import gasket from '../../gasket';

function getMetadataBaseUrl(): string {
  if (process.env.LOGIN_REDIRECT_URL) {
    try {
      const url = new URL(process.env.LOGIN_REDIRECT_URL);
      return url.origin; // Just need base URL for metadata
    } catch (error) {
      // If LOGIN_REDIRECT_URL is invalid, continue to fallbacks
    }
  }

  if (process.env.NODE_ENV === 'production') {
    return 'https://airo-builder.godaddy.com';
  }

  return 'http://localhost:3000';
}

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
  const defaultTitle = 'Airo Builder';
  const defaultDescription = "Share your idea and we'll handle the rest";
  const shareImageUrl = `${getMetadataBaseUrl()}/images/share.png`;
  
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
      openGraph: {
        title: title || defaultTitle,
        description: description || defaultDescription,
        images: [shareImageUrl],
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title: title || defaultTitle,
        description: description || defaultDescription,
        images: [shareImageUrl],
      },
    };
  } catch (error) {
    return {
      title: defaultTitle,
      description: defaultDescription,
      openGraph: {
        title: defaultTitle,
        description: defaultDescription,
        images: [shareImageUrl],
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title: defaultTitle,
        description: defaultDescription,
        images: [shareImageUrl],
      },
    };
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

const PresentationLayout = withGasketData(gasket)(makeLayout(gasket));

/**
 * Root layout component for the application
 *
 * **Translation Handling:**
 * - Fetches translations on server-side using getServerIntl (has Map cache)
 * - Map cache only stores successful non-empty results
 * - If server fetch fails (401, network error), falls back to client-side fetch
 * - Empty results are never cached, ensuring fresh attempts on subsequent requests
 *
 * This ensures translations load reliably regardless of initial auth state.
 */
async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await detectLocale();

  let messages: Record<string, string> | undefined;
  try {
    const fetchedMessages = await loadTranslations(locale, ['@airo/app-builder']);

    // Only use messages if they're not empty
    if (Object.keys(fetchedMessages).length > 0) {
      messages = fetchedMessages;
    }
  } catch (error) {
    // Translation load failed - fall back to client-side fetch
    logger.error('translations.layout.load.failure', { error });
  }

  return (
    <PresentationLayout>
      <FrameBuster />
      <Suspense fallback={null}>
        <ConversationIdCookie />
        <ReferralTracker />
      </Suspense>
      <RumProvider>
        <FullStoryProvider>
        <QueryClientProvider>
          <TranslationsProvider
            locale={locale}
            messages={messages}
            packages={['@airo/app-builder']}
          >
            <AuthProvider>
              <SubscriptionCacheProvider>
                <SessionTimeoutManager />
                <main className="flex-1 min-h-screen">
                  {children}
                </main>
                <GlobalSsoLogin />
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

import "@/styles/globals.scss";

import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { withGasketData } from '@gasket/nextjs/layout';
import { makeLayout } from '@godaddy/gasket-next/layout';

import GlobalSsoLogin from "@/components/auth/GlobalSsoLogin";
import ReturningUserCookieSync from "@/components/auth/ReturningUserCookieSync";
import SsoDebugTools from "@/components/auth/SsoDebugTools";
import AuthProvider from "@/components/providers/AuthProvider";
import FullStoryProvider from "@/components/providers/FullStoryProvider";
import { QueryClientProvider } from "@/components/providers/QueryClientProvider";
import SubscriptionCacheProvider from "@/components/providers/SubscriptionCacheProvider";
import { TranslationsProvider } from "@/components/providers/TranslationProvider";
import ConversationIdCookie from "@/components/security/ConversationIdCookie";
import FrameBuster from "@/components/security/FrameBuster";
import ItcInitializer from "@/components/tracking/ItcInitializer";
import JourneyTrackerInit, { JourneyTrackerAuth } from "@/components/tracking/JourneyTrackerInit";
import ReferralTracker from "@/components/tracking/ReferralTracker";
import { instrumentPageRequest } from "@/lib/apm-context";
import { logger } from "@/lib/request-context";
import { detectTranslationLocale, getServerIntl } from "@/lib/translations";
import { loadTranslations } from "@/lib/translations/load-translations";
import gasket from '../../../gasket';

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
    const locale = await detectTranslationLocale();
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
async function MarketLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ market: string }>;
}>) {
  const headersList = await headers();

  // Instrument page request for APM tracking (sets cid, span.type, pathname)
  // This runs in Node.js context where OpenTelemetry is active
  // Note: Middleware can't do this - it runs in Edge Runtime without OTel context
  await instrumentPageRequest(headersList);

  const locale = await detectTranslationLocale();

  let messages: Record<string, string> | undefined;
  try {
    const fetchedMessages = await loadTranslations(locale, ['@airo-app-builder/aab']);

    // Only use messages if they're not empty
    if (Object.keys(fetchedMessages).length > 0) {
      messages = fetchedMessages;
    }
  } catch (error) {
    // Translation load failed - fall back to client-side fetch
    logger.error('translations.layout.load.failure', { error });
  }

  try {
    const headersObj: Record<string, string> = {};
    headersList.forEach((value, key) => {
      headersObj[key] = value;
    });
    const getExperimentCohorts = gasket.actions.getExperimentCohorts;
    const cohorts =
      typeof getExperimentCohorts === 'function'
        ? await getExperimentCohorts({ headers: headersObj })
        : undefined;
    const aaCohort = cohorts?.['aa-airo-builder'];

    if (aaCohort) {
      logger.info('hivemind.experiment.triggered', {
        experimentId: 'aa-airo-builder',
        cohortId: aaCohort,
      });
    }
  } catch (error) {
    logger.warn('hivemind.experiment.error', {
      experimentId: 'aa-airo-builder',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return (
    <PresentationLayout params={params}>
      <FrameBuster key="market-frame-buster" />
      <JourneyTrackerInit key="market-journey-tracker-init" />
      <Suspense fallback={null}>
        <ConversationIdCookie key="market-conversation-id-cookie" />
        <ReferralTracker key="market-referral-tracker" />
        <ItcInitializer key="market-itc-initializer" />
      </Suspense>
      <FullStoryProvider key="market-fullstory">
        <QueryClientProvider key="market-query-client">
          <TranslationsProvider
            locale={locale}
            messages={messages}
            packages={['@airo-app-builder/aab']}
          >
            <AuthProvider>
              <JourneyTrackerAuth key="market-journey-tracker-auth" />
              <SubscriptionCacheProvider key="market-subscription-cache">
                <main className="flex-1 relative min-h-dvh" key="market-main">
                  {children}
                </main>
                <GlobalSsoLogin key="market-global-sso-login" />
                <ReturningUserCookieSync key="market-returning-user-cookie-sync" />
                <SsoDebugTools key="market-sso-debug-tools" />
              </SubscriptionCacheProvider>
            </AuthProvider>
          </TranslationsProvider>
        </QueryClientProvider>
      </FullStoryProvider>
    </PresentationLayout>
  )
}

export default MarketLayout;

export const revalidate = 600;

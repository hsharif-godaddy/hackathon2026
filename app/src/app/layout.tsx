import "@/styles/globals.scss";

import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { withGasketData } from '@gasket/nextjs/layout';
import { makeLayout } from '@godaddy/gasket-next/layout';

import AuthBoundary from "@/components/auth/AuthBoundary";
import GlobalSsoLogin from "@/components/auth/GlobalSsoLogin";
import SessionTimeoutManager from "@/components/auth/SessionTimeoutManager";
import AuthProvider from "@/components/providers/AuthProvider";
import FullStoryProvider from "@/components/providers/FullStoryProvider";
import { QueryClientProvider } from "@/components/providers/QueryClientProvider";
import SubscriptionCacheProvider from "@/components/providers/SubscriptionCacheProvider";
import { TranslationsProvider } from "@/components/providers/TranslationProvider";
import ConversationIdCookie from "@/components/security/ConversationIdCookie";
import FrameBuster from "@/components/security/FrameBuster";
import ItcInitializer from "@/components/tracking/ItcInitializer";
import ReferralTracker from "@/components/tracking/ReferralTracker";
import { EXPERIMENT_IDS } from "@/config/experiments";
import { instrumentPageRequest } from "@/lib/apm-context";
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

async function resolveTranslations() {
  const locale = await detectLocale();
  let messages: Record<string, string> | undefined;
  try {
    const fetched = await loadTranslations(locale, ['@airo-app-builder/aab']);
    if (Object.keys(fetched).length > 0) {
      messages = fetched;
    }
  } catch (error) {
    logger.error('translations.layout.load.failure', { error });
  }
  return { locale, messages };
}

async function resolveExperiments(
  headersList: Awaited<ReturnType<typeof headers>>
): Promise<string | undefined> {
  try {
    const cohorts = await gasket.actions.getExperimentCohorts({
      headers: Object.fromEntries(headersList.entries()),
    });
    const aaCohort = cohorts?.['aa-airo-builder'];

    if (aaCohort) {
      logger.info('hivemind.experiment.triggered', {
        experimentId: 'aa-airo-builder',
        cohortId: aaCohort,
      });
    }

    return cohorts?.[EXPERIMENT_IDS.homepageEngagement] as string | undefined;
  } catch (error) {
    logger.error('hivemind.experiments.error', {
      experimentIds: JSON.stringify(['aa-airo-builder', EXPERIMENT_IDS.homepageEngagement]),
      error,
    });
    return undefined;
  }
}

/**
 * Root layout component for the application
 *
 * **Translation Handling:**
 * - Detects the active locale on the server with `detectLocale()`
 * - Loads translations for `@airo-app-builder/aab` via `loadTranslations()`
 * - Only passes `messages` to `TranslationsProvider` when non-empty translations are returned
 * - Logs translation load failures and continues rendering with the resolved locale
 *
 * Translation caching behavior is defined by the underlying `loadTranslations()`
 * implementation rather than by this layout.
 */
async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();

  const [{ locale, messages }, homepageEngagementCohort] = await Promise.all([
    resolveTranslations(),
    resolveExperiments(headersList),
    instrumentPageRequest(headersList).catch((error) => {
      logger.error('apm.instrumentation.error', { error });
    }), // result unused — awaited only for side-effect
  ]);

  return (
    <PresentationLayout>
      <FrameBuster />
      <Suspense fallback={null}>
        <ConversationIdCookie />
        <ReferralTracker />
        <ItcInitializer />
      </Suspense>
      <FullStoryProvider>
        <QueryClientProvider>
          <TranslationsProvider
            homepageEngagementCohort={homepageEngagementCohort}
            locale={locale}
            messages={messages}
            packages={['@airo-app-builder/aab']}
          >
            <AuthProvider homepageEngagementCohort={homepageEngagementCohort}>
              <SubscriptionCacheProvider>
                <SessionTimeoutManager />
                <AuthBoundary>
                  <main className="flex-1 relative min-h-dvh">
                    {children}
                  </main>
                </AuthBoundary>
                <GlobalSsoLogin />
              </SubscriptionCacheProvider>
            </AuthProvider>
          </TranslationsProvider>
        </QueryClientProvider>
      </FullStoryProvider>
    </PresentationLayout>
  )
}

export default RootLayout;

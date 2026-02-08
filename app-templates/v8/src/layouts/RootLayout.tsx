import { Component, lazy, ReactElement, ReactNode, Suspense, type ErrorInfo } from 'react';

import Footer from '@/layouts/parts/Footer';
import Header from '@/layouts/parts/Header';
import Website from '@/layouts/Website';

// Lazy load CookieBanner - if blocked by ad blockers, the app continues without it
const CookieBanner = lazy(() =>
  import('@/components/CookieBanner').catch((error) => {
    console.warn('Failed to load CookieBanner:', error);
    return {
      default: () => null,
    };
  })
);

// Error boundary to catch any render errors from CookieBanner
class CookieBannerErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static getDerivedStateFromError(error: unknown): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('CookieBanner error boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

/**
 * Root layout component that wraps all pages with consistent header and footer
 *
 * This component provides a centralized layout structure for the entire application,
 * ensuring consistent navigation and footer across all pages. It uses the Website
 * layout component and includes Header and Footer components.
 *
 * To customize the header or footer, directly edit the Header.tsx and Footer.tsx files
 * in the layouts/parts directory.
 *
 * @param children - Child routes to render (typically <Outlet /> from react-router-dom)
 *
 * @example
 * ```tsx
 * <RootLayout>
 *   <Outlet />
 * </RootLayout>
 * ```
 */
interface RootLayoutProps {
  children: ReactElement;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <Website>
      <Header />
      {children}
      <Footer />
      <CookieBannerErrorBoundary>
        <Suspense fallback={null}>
          <CookieBanner />
        </Suspense>
      </CookieBannerErrorBoundary>
    </Website>
  );
}

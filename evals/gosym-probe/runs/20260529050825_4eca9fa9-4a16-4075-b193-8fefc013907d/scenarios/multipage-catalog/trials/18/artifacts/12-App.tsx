src/App.tsx [1-35 of 72] (truncated — use startLine/numLines to read remaining)
     1|import { lazy, Suspense } from 'react';
     2|import {
     3|  Outlet,
     4|  RouterProvider,
     5|  createBrowserRouter,
     6|  type RouteObject,
     7|} from 'react-router-dom';
     8|
     9|import AiroErrorBoundary from '../dev-tools/src/AiroErrorBoundary';
    10|import CookieBannerErrorBoundary from '@/components/CookieBannerErrorBoundary';
    11|import RootLayout from './layouts/RootLayout';
    12|import Spinner from './components/Spinner';
    13|import { routes } from './routes';
    14|
    15|const CookieBanner = lazy(() =>
    16|  import('@/components/CookieBanner').catch((error) => {
    17|    console.warn('Failed to load CookieBanner:', error);
    18|    return { default: () => null };
    19|  })
    20|);
    21|
    22|const SpinnerFallback = () => (
    23|  <div className="flex justify-center py-8 h-screen items-center">
    24|    <Spinner />
    25|  </div>
    26|);
    27|
    28|const rootElement = (
    29|  <Suspense fallback={<SpinnerFallback />}>
    30|    <RootLayout>
    31|      <Outlet />
    32|    </RootLayout>
    33|  </Suspense>
    34|);
    35|
src/routes.tsx [45 lines]
     1|import { RouteObject } from 'react-router-dom';
     2|import { lazy } from 'react';
     3|import HomePage from './pages/index';
     4|import ShopPage from './pages/shop';
     5|import AboutPage from './pages/about';
     6|// Eager import so renderToString doesn't hit a Suspense boundary on 404 routes
     7|// and abort to client rendering. The prod 404 page is tiny; the dev-tools
     8|// variant stays lazy because it pulls in dev-only code we don't want in
     9|// production bundles.
    10|import ProdNotFoundPage from './pages/_404';
    11|
    12|const NotFoundPage = import.meta.env.DEV
    13|  ? lazy(() => import('../dev-tools/src/PageNotFound'))
    14|  : ProdNotFoundPage;
    15|
    16|export const routes: RouteObject[] = [
    17|  {
    18|    path: '/',
    19|    element: <HomePage />,
    20|  },
    21|  {
    22|    path: '/shop',
    23|    element: <ShopPage />,
    24|    loader: async () => {
    25|      const res = await fetch('/api/products');
    26|      if (!res.ok) throw new Response(null, { status: res.status });
    27|      const products = await res.json();
    28|      return { products };
    29|    },
    30|  },
    31|  {
    32|    path: '/about',
    33|    element: <AboutPage />,
    34|  },
    35|  {
    36|    path: '*',
    37|    element: <NotFoundPage />,
    38|  },
    39|];
    40|
    41|// Types for type-safe navigation
    42|export type Path = '/' | '/shop' | '/about';
    43|
    44|export type Params = Record<string, string | undefined>;
    45|
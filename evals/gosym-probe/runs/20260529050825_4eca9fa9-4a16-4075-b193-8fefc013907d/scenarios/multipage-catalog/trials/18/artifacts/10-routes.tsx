src/routes.tsx [52 lines]
     1|import { RouteObject } from 'react-router-dom';
     2|import { lazy } from 'react';
     3|import HomePage from './pages/index';
     4|import ProductsPage from './pages/products';
     5|import AboutPage from './pages/about';
     6|// Eager import so renderToString doesn't hit a Suspense boundary on 404 routes
     7|// and abort to client rendering. The prod 404 page is tiny; the dev-tools
     8|// variant stays lazy because it pulls in dev-only code we don't want in
     9|// production bundles.
    10|import ProdNotFoundPage from './pages/_404';
    11|import type { Product } from './server/api/products/GET';
    12|
    13|const NotFoundPage = import.meta.env.DEV
    14|  ? lazy(() => import('../dev-tools/src/PageNotFound'))
    15|  : ProdNotFoundPage;
    16|
    17|async function productsLoader() {
    18|  const base =
    19|    typeof window !== 'undefined'
    20|      ? ''
    21|      : (process.env.PUBLIC_URL || process.env.SITE_URL || 'http://localhost:3000');
    22|  const res = await fetch(`${base}/api/products`);
    23|  if (!res.ok) throw new Response(null, { status: res.status });
    24|  const products: Product[] = await res.json();
    25|  return { products };
    26|}
    27|
    28|export const routes: RouteObject[] = [
    29|  {
    30|    path: '/',
    31|    element: <HomePage />,
    32|  },
    33|  {
    34|    path: '/products',
    35|    element: <ProductsPage />,
    36|    loader: productsLoader,
    37|  },
    38|  {
    39|    path: '/about',
    40|    element: <AboutPage />,
    41|  },
    42|  {
    43|    path: '*',
    44|    element: <NotFoundPage />,
    45|  },
    46|];
    47|
    48|// Types for type-safe navigation
    49|export type Path = '/' | '/products' | '/about';
    50|
    51|export type Params = Record<string, string | undefined>;
    52|
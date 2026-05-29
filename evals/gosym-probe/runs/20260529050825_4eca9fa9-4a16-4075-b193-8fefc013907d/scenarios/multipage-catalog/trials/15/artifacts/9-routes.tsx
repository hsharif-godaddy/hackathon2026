src/routes.tsx [57 lines]
     1|import { RouteObject } from 'react-router-dom';
     2|import { lazy } from 'react';
     3|import HomePage from './pages/index';
     4|import ProductsPage from './pages/products';
     5|import AboutPage from './pages/about';
     6|import type { Product } from './server/api/products/GET';
     7|
     8|// Eager import so renderToString doesn't hit a Suspense boundary on 404 routes
     9|// and abort to client rendering. The prod 404 page is tiny; the dev-tools
    10|// variant stays lazy because it pulls in dev-only code we don't want in
    11|// production bundles.
    12|import ProdNotFoundPage from './pages/_404';
    13|
    14|const NotFoundPage = import.meta.env.DEV
    15|  ? lazy(() => import('../dev-tools/src/PageNotFound'))
    16|  : ProdNotFoundPage;
    17|
    18|async function fetchProducts(params?: string): Promise<Product[]> {
    19|  const base = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
    20|  const url = `${base}/api/products${params ? `?${params}` : ''}`;
    21|  const res = await fetch(url);
    22|  if (!res.ok) throw new Response(null, { status: res.status });
    23|  return res.json() as Promise<Product[]>;
    24|}
    25|
    26|export const routes: RouteObject[] = [
    27|  {
    28|    path: '/',
    29|    element: <HomePage />,
    30|    loader: async () => {
    31|      const featured = await fetchProducts('featured=true');
    32|      return { featured };
    33|    },
    34|  },
    35|  {
    36|    path: '/products',
    37|    element: <ProductsPage />,
    38|    loader: async () => {
    39|      const products = await fetchProducts();
    40|      return { products };
    41|    },
    42|  },
    43|  {
    44|    path: '/about',
    45|    element: <AboutPage />,
    46|  },
    47|  {
    48|    path: '*',
    49|    element: <NotFoundPage />,
    50|  },
    51|];
    52|
    53|// Types for type-safe navigation
    54|export type Path = '/' | '/products' | '/about';
    55|
    56|export type Params = Record<string, string | undefined>;
    57|
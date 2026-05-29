src/routes.tsx [54 lines]
     1|import { RouteObject } from 'react-router-dom';
     2|import { lazy } from 'react';
     3|import HomePage from './pages/index';
     4|import ProductsPage from './pages/products';
     5|import AboutPage from './pages/about';
     6|import type { Product } from './server/api/products/GET';
     7|// Eager import so renderToString doesn't hit a Suspense boundary on 404 routes
     8|// and abort to client rendering. The prod 404 page is tiny; the dev-tools
     9|// variant stays lazy because it pulls in dev-only code we don't want in
    10|// production bundles.
    11|import ProdNotFoundPage from './pages/_404';
    12|
    13|const NotFoundPage = import.meta.env.DEV
    14|  ? lazy(() => import('../dev-tools/src/PageNotFound'))
    15|  : ProdNotFoundPage;
    16|
    17|export const routes: RouteObject[] = [
    18|  {
    19|    path: '/',
    20|    element: <HomePage />,
    21|    loader: async () => {
    22|      const base = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
    23|      const res = await fetch(`${base}/api/products`);
    24|      if (!res.ok) return { products: [] };
    25|      const products: Product[] = await res.json();
    26|      return { products };
    27|    },
    28|  },
    29|  {
    30|    path: '/products',
    31|    element: <ProductsPage />,
    32|    loader: async () => {
    33|      const base = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
    34|      const res = await fetch(`${base}/api/products`);
    35|      if (!res.ok) return { products: [] };
    36|      const products: Product[] = await res.json();
    37|      return { products };
    38|    },
    39|  },
    40|  {
    41|    path: '/about',
    42|    element: <AboutPage />,
    43|  },
    44|  {
    45|    path: '*',
    46|    element: <NotFoundPage />,
    47|  },
    48|];
    49|
    50|// Types for type-safe navigation
    51|export type Path = '/' | '/products' | '/about';
    52|
    53|export type Params = Record<string, string | undefined>;
    54|
src/routes.tsx [29 lines]
     1|import { RouteObject } from 'react-router-dom';
     2|import { lazy } from 'react';
     3|import HomePage from './pages/index';
     4|// Eager import so renderToString doesn't hit a Suspense boundary on 404 routes
     5|// and abort to client rendering. The prod 404 page is tiny; the dev-tools
     6|// variant stays lazy because it pulls in dev-only code we don't want in
     7|// production bundles.
     8|import ProdNotFoundPage from './pages/_404';
     9|
    10|const NotFoundPage = import.meta.env.DEV
    11|  ? lazy(() => import('../dev-tools/src/PageNotFound'))
    12|  : ProdNotFoundPage;
    13|
    14|export const routes: RouteObject[] = [
    15|  {
    16|    path: '/',
    17|    element: <HomePage />,
    18|  },
    19|  {
    20|    path: '*',
    21|    element: <NotFoundPage />,
    22|  },
    23|];
    24|
    25|// Types for type-safe navigation
    26|export type Path = '/';
    27|
    28|export type Params = Record<string, string | undefined>;
    29|
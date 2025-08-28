import { RouteObject } from 'react-router-dom';
import { lazy } from 'react';

// Lazy load components for code splitting
const HomePage = lazy(() => import('./pages/index'));
const NotFoundPage = lazy(() => import('./pages/_404'));

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <HomePage />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
];

// Types for type-safe navigation
export type Path = '/';

export type Params = Record<string, string | undefined>;
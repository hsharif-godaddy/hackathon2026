import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { Suspense } from 'react';
import Layout from './components/layout/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { routes } from './routes';
import GeometricSpinner from './components/GeometricSpinner';

// Create router with layout wrapper
const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <ErrorBoundary>
        <Layout>
          <Suspense fallback={<div className="flex justify-center py-8"><GeometricSpinner /></div>}>
            <Outlet />
          </Suspense>
        </Layout>
      </ErrorBoundary>
    ),
    children: routes,
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}

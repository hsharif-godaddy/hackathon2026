import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { Suspense } from 'react';
import CompileErrorCatcher from '../dev-tools/src/CompileErrorCatcher';
import { routes } from './routes';
import GeometricSpinner from './components/GeometricSpinner';

// Create router with layout wrapper
const router = createBrowserRouter([
  {
    path: '/',
    element: import.meta.env.DEV ? (
      <CompileErrorCatcher>
        <Suspense fallback={<div className="flex justify-center py-8"><GeometricSpinner /></div>}>
          <Outlet />
        </Suspense>
      </CompileErrorCatcher>
    ) : (
      <Suspense fallback={<div className="flex justify-center py-8"><GeometricSpinner /></div>}>
        <Outlet />
      </Suspense>
    ),
    children: routes,
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}

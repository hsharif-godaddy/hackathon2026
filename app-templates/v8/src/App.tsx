import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { Suspense } from 'react';
import CompileErrorCatcher from '../dev-tools/src/CompileErrorCatcher';
import { routes } from './routes';
import Spinner from './components/Spinner';

const SpinnerFallback = () => (
  <div className="flex justify-center py-8 h-screen items-center">
    <Spinner />
  </div>
);

// Create router with layout wrapper
const router = createBrowserRouter([
  {
    path: '/',
    element: import.meta.env.DEV ? (
      <CompileErrorCatcher>
        <Suspense fallback={<SpinnerFallback />}>
          <Outlet />
        </Suspense>
      </CompileErrorCatcher>
    ) : (
      <Suspense fallback={<SpinnerFallback />}>
        <Outlet />
      </Suspense>
    ),
    children: routes,
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}

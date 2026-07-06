import { RouteObject, Navigate } from "react-router-dom";
import { lazy } from "react";
import { FeatureGate } from "./contexts/FeatureFlagsContext";
import HomePage from "./pages/index";
// Eager import so renderToString doesn't hit a Suspense boundary on 404 routes
// and abort to client rendering. The prod 404 page is tiny; the dev-tools
// variant stays lazy because it pulls in dev-only code we don't want in
// production bundles.
import ProdNotFoundPage from "./pages/_404";

const NotFoundPage = import.meta.env.DEV
  ? lazy(() => import("../dev-tools/src/PageNotFound"))
  : ProdNotFoundPage;

// Public booking pages
const BookPage = lazy(() => import("./pages/book/index"));
const BookServicePage = lazy(() => import("./pages/book/[serviceId]"));
const BookPaymentSuccessPage = lazy(() => import("./pages/book/payment-success"));
const BookPaymentCancelPage = lazy(() => import("./pages/book/payment-cancel"));

// Customer my-bookings pages
const MyBookingsPage = lazy(() => import("./pages/my-bookings/index"));
const MyBookingDetailPage = lazy(() => import("./pages/my-bookings/[id]"));

// Admin layout (wraps all /admin/* routes outside RootLayout)
const AdminLayout = lazy(() => import("./layouts/AdminLayout"));
const AdminLoginPage = lazy(() => import("./pages/admin/login"));
const AdminSetupPage = lazy(() => import("./pages/admin/setup"));
const AdminDashboardPage = lazy(() => import("./pages/admin/index"));
const AdminBookingsPage = lazy(() => import("./pages/admin/bookings/index"));
const AdminBookingDetailPage = lazy(() => import("./pages/admin/bookings/[id]"));
const AdminServicesPage = lazy(() => import("./pages/admin/services/index"));
const AdminServiceDetailPage = lazy(() => import("./pages/admin/services/[id]"));
const AdminClientsPage = lazy(() => import("./pages/admin/clients/index"));
const AdminClientDetailPage = lazy(() => import("./pages/admin/clients/[id]"));
const AdminCouponsPage = lazy(() => import("./pages/admin/coupons/index"));
const AdminCouponDetailPage = lazy(() => import("./pages/admin/coupons/[id]"));
const AdminAddonsPage = lazy(() => import("./pages/admin/addons/index"));
const AdminAddonDetailPage = lazy(() => import("./pages/admin/addons/[id]"));
const AdminSettingsPage = lazy(() => import("./pages/admin/settings"));
const AdminAvailabilityPage = lazy(() => import("./pages/admin/availability"));
const AdminStaffPage = lazy(() => import("./pages/admin/staff/index"));
const AdminPaymentsPage = lazy(() => import("./pages/admin/payments/index"));
const AdminStaffDetailPage = lazy(() => import("./pages/admin/staff/[id]"));

// Auth pages
const LoginPage = lazy(() => import("./pages/login"));
const SignupPage = lazy(() => import("./pages/signup"));

// Debug console
const DebugPage = lazy(() => import("./pages/debug"));

import { Suspense } from "react";
import Spinner from "./components/Spinner";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/signup",
    element: <SignupPage />,
  },
  {
    path: "/book",
    element: (
      <FeatureGate feature="customer.booking_flow" fallback={<Navigate to="/" replace />}>
        <BookPage />
      </FeatureGate>
    ),
  },
  // These static paths must come before /book/:serviceId so the param doesn't swallow them
  {
    path: "/book/payment-success",
    element: (
      <FeatureGate feature="customer.booking_flow.payment" fallback={<Navigate to="/" replace />}>
        <BookPaymentSuccessPage />
      </FeatureGate>
    ),
  },
  {
    path: "/book/payment-cancel",
    element: (
      <FeatureGate feature="customer.booking_flow.payment" fallback={<Navigate to="/" replace />}>
        <BookPaymentCancelPage />
      </FeatureGate>
    ),
  },
  {
    path: "/book/:serviceId",
    element: (
      <FeatureGate feature="customer.booking_flow" fallback={<Navigate to="/" replace />}>
        <BookServicePage />
      </FeatureGate>
    ),
  },
  {
    path: "/my-bookings",
    element: (
      <FeatureGate feature="customer.my_bookings" fallback={<Navigate to="/" replace />}>
        <MyBookingsPage />
      </FeatureGate>
    ),
  },
  {
    path: "/my-bookings/:id",
    element: (
      <FeatureGate feature="customer.my_bookings" fallback={<Navigate to="/" replace />}>
        <MyBookingDetailPage />
      </FeatureGate>
    ),
  },
  { path: "/debug", element: <DebugPage /> },
  {
    path: "*",
    element: <NotFoundPage />,
  },
];

// Admin routes live outside RootLayout in App.tsx
export const adminRoutes: RouteObject[] = [
  {
    element: (
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <AdminLayout />
      </Suspense>
    ),
    children: [
      { path: "/admin/login", element: <AdminLoginPage /> },
      { path: "/admin/setup", element: <AdminSetupPage /> },
      { path: "/admin", element: <AdminDashboardPage /> },
      {
        path: "/admin/bookings",
        element: (
          <FeatureGate feature="admin.bookings" fallback={<Navigate to="/admin" replace />}>
            <AdminBookingsPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/bookings/:id",
        element: (
          <FeatureGate feature="admin.bookings" fallback={<Navigate to="/admin" replace />}>
            <AdminBookingDetailPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/services",
        element: (
          <FeatureGate feature="admin.services" fallback={<Navigate to="/admin" replace />}>
            <AdminServicesPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/services/:id",
        element: (
          <FeatureGate feature="admin.services" fallback={<Navigate to="/admin" replace />}>
            <AdminServiceDetailPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/clients",
        element: (
          <FeatureGate feature="admin.clients" fallback={<Navigate to="/admin" replace />}>
            <AdminClientsPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/clients/:id",
        element: (
          <FeatureGate feature="admin.clients" fallback={<Navigate to="/admin" replace />}>
            <AdminClientDetailPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/availability",
        element: (
          <FeatureGate feature="admin.availability" fallback={<Navigate to="/admin" replace />}>
            <AdminAvailabilityPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/staff",
        element: (
          <FeatureGate feature="admin.staff" fallback={<Navigate to="/admin" replace />}>
            <AdminStaffPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/staff/:id",
        element: (
          <FeatureGate feature="admin.staff" fallback={<Navigate to="/admin" replace />}>
            <AdminStaffDetailPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/coupons",
        element: (
          <FeatureGate feature="admin.coupons" fallback={<Navigate to="/admin" replace />}>
            <AdminCouponsPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/coupons/:id",
        element: (
          <FeatureGate feature="admin.coupons" fallback={<Navigate to="/admin" replace />}>
            <AdminCouponDetailPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/addons",
        element: (
          <FeatureGate feature="admin.addons" fallback={<Navigate to="/admin" replace />}>
            <AdminAddonsPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/addons/:id",
        element: (
          <FeatureGate feature="admin.addons" fallback={<Navigate to="/admin" replace />}>
            <AdminAddonDetailPage />
          </FeatureGate>
        ),
      },
      {
        path: "/admin/payments",
        element: (
          <FeatureGate feature="admin.payments" fallback={<Navigate to="/admin" replace />}>
            <AdminPaymentsPage />
          </FeatureGate>
        ),
      },
      { path: "/admin/settings", element: <AdminSettingsPage /> },
    ],
  },
];

// Types for type-safe navigation
export type Path =
  | "/"
  | "/book"
  | "/book/:serviceId"
  | "/my-bookings"
  | "/my-bookings/:id"
  | "/admin"
  | "/admin/login"
  | "/admin/setup"
  | "/admin/bookings"
  | "/admin/bookings/:id"
  | "/admin/services"
  | "/admin/services/:id"
  | "/admin/clients"
  | "/admin/clients/:id"
  | "/admin/availability"
  | "/admin/staff"
  | "/admin/staff/:id"
  | "/admin/coupons"
  | "/admin/coupons/:id"
  | "/admin/addons"
  | "/admin/addons/:id"
  | "/admin/settings";

export type Params = Record<string, string | undefined>;

# §14 Admin System

Complete guide to the admin dashboard: authentication, layout, navigation setup, and troubleshooting.


---

## Admin Authentication

### How it Works

Admin auth uses token-based authentication (NOT cookie-based like customer auth). The token is stored in `localStorage` and sent with every admin API request via the `Authorization: Bearer <token>` header.

**Critical:** Admin auth is completely separate from customer auth. They use different endpoints, different storage mechanisms, and different middleware.

### Admin Auth Endpoints

**Correct URL pattern:** `/api/appointments/admin/auth/...`

```http
POST /api/appointments/admin/auth/setup
POST /api/appointments/admin/auth/login
POST /api/appointments/admin/auth/logout
GET  /api/appointments/admin/auth/me
```

**Common mistake:** Using `/api/admin/auth/...` — this will return 404. The correct prefix is `/api/appointments/admin/auth/`.

### First-Time Setup Flow

1. User visits `/admin/setup`
2. Sees a form: name, email, password
3. Submits → `POST /api/appointments/admin/auth/setup`
4. Server checks if any admin exists:
   - If yes → return 403 "Admin already exists"
   - If no → create admin user, return token
5. Token stored in `localStorage.setItem('admin_token', token)`
6. User redirected to `/admin` dashboard

**Important:** The setup endpoint is a one-time action. Once an admin exists, it returns 403. Additional admins are created via the staff management UI (if `admin.staff` is enabled).

**After admin is set up — seed initial data:**

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/11-seeding' })
```

Load §11 to populate services, business settings, business hours, and sample bookings so the admin dashboard is not empty on first login.

### Login Flow

1. User visits `/admin/login`
2. Enters email + password
3. Submits → `POST /api/appointments/admin/auth/login`
4. Server validates credentials, returns token
5. Token stored in `localStorage`
6. User redirected to `/admin`

### Logout Flow

1. User clicks "Logout" in admin header
2. `POST /api/appointments/admin/auth/logout` (optional — server may invalidate token)
3. `localStorage.removeItem('admin_token')`
4. User redirected to `/admin/login`

---

## Admin Auth Provider

The `AdminAuthProvider` (in `src/contexts/AdminAuthContext.tsx`) manages login state. It must wrap all admin routes in the provider tree.

**Provider setup in RootLayout:**

```tsx
import { AdminAuthProvider } from './contexts/AdminAuthContext';
import { CustomerAuthProvider } from './contexts/CustomerAuthContext';
import { FeatureFlagsProvider } from './contexts/FeatureFlagsContext';
import { AppConfigProvider } from './contexts/AppConfigContext';

export function RootLayout() {
  return (
    <AdminAuthProvider>
      <CustomerAuthProvider>
        <FeatureFlagsProvider>
          <AppConfigProvider>
            <RouterProvider router={router} />
          </AppConfigProvider>
        </FeatureFlagsProvider>
      </CustomerAuthProvider>
    </AdminAuthProvider>
  );
}
```

**Important:** AdminAuthProvider must be the outermost provider (it doesn't depend on any other context).

---

## Admin Layout and Navigation

### Wiring AdminLayout in routes.tsx

Admin pages must be nested under `AdminLayout` as a parent layout route so they get the sidebar shell instead of the public site header/footer. **Do not** put admin routes inside `RootLayout` — they are completely separate.

Correct structure in `src/routes.tsx` (or wherever the router is defined):

```tsx
import { AdminLayout } from '@/layouts/AdminLayout';
import { AdminAuthProvider } from '@/contexts/AdminAuthContext';

const router = createBrowserRouter([
  {
    // Public site — uses RootLayout
    element: <RootLayout />,
    children: [
      { path: '/', element: <Home /> },
      // ... other public routes
    ],
  },
  {
    // Admin site — AdminLayout owns auth protection internally, no wrapper needed
    element: <AdminLayout />,
    children: [
      { path: '/admin', element: <AdminDashboard /> },
      { path: '/admin/bookings', element: <AdminBookings /> },
      { path: '/admin/services', element: <AdminServices /> },
      { path: '/admin/staff', element: <AdminStaff /> },
      { path: '/admin/clients', element: <AdminClients /> },
      { path: '/admin/coupons', element: <AdminCoupons /> },
      { path: '/admin/categories', element: <AdminCategories /> },
      { path: '/admin/questions', element: <AdminQuestions /> },
      { path: '/admin/availability', element: <AdminAvailability /> },
      { path: '/admin/settings', element: <AdminSettings /> },
      // Auth pages wrapped with their own provider so they work regardless of nesting
      { path: '/admin/login', element: <AdminAuthProvider><AdminLoginPage /></AdminAuthProvider> },
      { path: '/admin/setup', element: <AdminAuthProvider><AdminSetupPage /></AdminAuthProvider> },
    ],
  },
]);
```

**Common mistakes:**
- Nesting admin routes inside `RootLayout` — they will render with the public header/footer around them.
- Creating a `ProtectedAdminRoute` component and wrapping `AdminLayout` with it — `ProtectedAdminRoute` calls `useAdminAuth()` but sits outside `AdminLayout` which owns `AdminAuthProvider`, causing "useAdminAuth must be used within AdminAuthProvider". **Do not create `ProtectedAdminRoute`. `AdminLayout` handles auth protection internally.**
- Adding `AdminAuthProvider` to `App.tsx` or `RootLayout` separately — `AdminLayout` already includes it; a duplicate provider causes context conflicts.

### Layout Structure

Admin pages use a separate layout from public pages. The layout includes:
- **Header** — business name/logo, admin user dropdown, logout button
- **Sidebar** — navigation links to admin sections
- **Content area** — the actual admin page

Edit `src/layouts/AdminLayout.tsx` to customize the layout.

### Sidebar Navigation

The sidebar shows links to enabled admin features. Example structure:

```tsx
const navItems = [
  { path: '/admin', label: 'Dashboard', icon: Home },
  { path: '/admin/bookings', label: 'Bookings', icon: Calendar, feature: 'admin.bookings' },
  { path: '/admin/services', label: 'Services', icon: List, feature: 'admin.services' },
  { path: '/admin/staff', label: 'Staff', icon: Users, feature: 'admin.staff' },
  { path: '/admin/clients', label: 'Clients', icon: UserCircle, feature: 'admin.clients' },
  { path: '/admin/coupons', label: 'Coupons', icon: Tag, feature: 'admin.coupons' },
  { path: '/admin/categories', label: 'Categories', icon: Folder, feature: 'admin.categories' },
  { path: '/admin/questions', label: 'Questions', icon: HelpCircle, feature: 'admin.questions' },
  { path: '/admin/availability', label: 'Availability', icon: Clock, feature: 'admin.availability' },
  { path: '/admin/settings', label: 'Settings', icon: Settings, feature: 'admin.settings' },
];
```

**Feature gating:** Each nav item checks `isFeatureEnabled(feature)` — if the feature is disabled, the link doesn't appear.

### Header Configuration

The admin header shows the logged-in user's name and a dropdown menu. This is configured in `src/lib/admin-config.ts`:

```typescript
export const adminConfig = {
  header: {
    showLogo: true,
    user: {
      show: true,
      showAvatar: true,
      dropdownItems: [
        { label: 'Profile', path: '/admin/profile' },
        { label: 'Settings', path: '/admin/settings' },
        { label: 'Logout', action: 'logout' },
      ],
    },
  },
  sidebar: {
    showHeader: true,
    collapsible: true,
  },
};
```

**Common mistake:** Putting the `user` object under `sidebar` instead of `header`. The user dropdown is part of the header, not the sidebar.

---

## Admin API Client

All admin API calls go through `src/lib/admin-api-client.ts`. This utility:
- Automatically adds the `Authorization: Bearer <token>` header
- Handles 401 responses (token expired → redirect to login)
- Wraps fetch in a consistent error-handling pattern

Example usage:

```typescript
import { adminApiClient } from '@/lib/admin-api-client';

// GET request
const bookings = await adminApiClient.get('/api/appointments/admin/bookings');

// POST request
const newService = await adminApiClient.post('/api/appointments/admin/services', {
  name: 'Deep Tissue Massage',
  durationMinutes: 60,
  price: 9000,
  currency: 'USD',
});

// PATCH request
await adminApiClient.patch(`/api/appointments/admin/services/${serviceId}`, {
  price: 12000,
});

// DELETE request
await adminApiClient.delete(`/api/appointments/admin/services/${serviceId}`);
```

**Important:** Never use `fetch()` directly for admin API calls. Always use `adminApiClient` so token handling is consistent.

---

## Protected Admin Routes

**Do not create a `ProtectedAdminRoute` component.** `AdminLayout` already handles auth protection internally — unauthenticated requests redirect to `/admin/login` inside `AdminLayoutInner`. A separate `ProtectedAdminRoute` that calls `useAdminAuth()` will always fail with "useAdminAuth must be used within AdminAuthProvider" because it renders outside `AdminLayout` (and therefore outside `AdminAuthProvider`).

The correct protection pattern is built into `AdminLayout`:

```tsx
// AdminLayoutInner inside AdminLayout already does this:
const { isAuthenticated } = useAdminAuth(); // has context — it's inside AdminAuthProvider
useEffect(() => {
  if (!isAuthenticated && !isAuthPage) {
    void navigate('/admin/login', { replace: true });
  }
}, [isAuthenticated]);
```

No additional wrapper is needed.

---

## SSR Safety

**Critical:** Admin auth uses `localStorage`, which doesn't exist on the server during SSR. All `localStorage` access must be guarded:

```typescript
// ❌ WRONG — crashes during SSR
const token = localStorage.getItem('admin_token');

// ✅ CORRECT
const token = typeof window === 'undefined' ? null : localStorage.getItem('admin_token');
```

This applies to:
- `localStorage.getItem('admin_token')`
- `localStorage.setItem('admin_token', value)`
- `localStorage.removeItem('admin_token')`

The `AdminAuthContext` already handles this internally, but if you access `localStorage` directly anywhere else, add the guard.

---

## Troubleshooting

### "useAdminAuth must be used within AdminAuthProvider" — ProtectedAdminRoute outside AdminLayout

**Cause:** A `ProtectedAdminRoute` component was created and used to wrap `AdminLayout` in the router. `ProtectedAdminRoute` calls `useAdminAuth()` but it renders outside `AdminLayout`, which is where `AdminAuthProvider` lives.

**Fix:** Delete `ProtectedAdminRoute` entirely. Use `AdminLayout` directly as the route element — it handles auth protection internally. See "Protected Admin Routes" section above.

---

### "useAdminAuth must be used within AdminAuthProvider" on first load

**Cause:** `entry-server.tsx` does not include `adminRoutes`, so the server renders a 404 for `/admin/*` paths. `main.tsx` calls `hydrateRoot` over the mismatched HTML, and during React 18's recovery the lazy `AdminLayout` (which owns `AdminAuthProvider`) hasn't resolved yet when admin components mount.

**Fix:** Wrap the login and setup route elements with `AdminAuthProvider` directly so they work regardless of how deeply they are nested in the router:

```tsx
import { AdminAuthProvider } from "@/contexts/AdminAuthContext";

{ path: "/admin/login", element: <AdminAuthProvider><AdminLoginPage /></AdminAuthProvider> },
{ path: "/admin/setup", element: <AdminAuthProvider><AdminSetupPage /></AdminAuthProvider> },
```

Each auth page gets its own provider instance that reads the token from `localStorage`. When the user logs in and is redirected to `/admin`, the dashboard's `AdminAuthProvider` (inside `AdminLayout`) reads the same `localStorage` entry and picks up the session.

---

**Fix:** Edit `src/entry-server.tsx`:

```typescript
// 1. Add adminRoutes to the import
import { routes, adminRoutes } from "./routes";

// 2. Spread into the route tree after the public routes block
const routeTree: RouteObject[] = [
  { element: ( /* RootLayout block — unchanged */ ), children: routes },
  ...adminRoutes,
];
```

See `src/entry-server.appointments.tsx` for the complete reference.

---

### "Cannot read property 'getItem' of undefined"

**Cause:** Accessing `localStorage` during SSR without a guard.

**Fix:** Add `typeof window === 'undefined'` check before all `localStorage` access.

### Admin API returns 404

**Cause:** Using the wrong URL prefix.

**Fix:** Use `/api/appointments/admin/auth/...` NOT `/api/admin/auth/...`.

### Token expired, stuck in redirect loop

**Cause:** Token is expired but not being cleared from `localStorage`.

**Fix:** In `adminApiClient`, ensure 401 responses call `localStorage.removeItem('admin_token')` before redirecting to login.

### Sidebar shows all links even when features are disabled

**Cause:** Feature gate check is missing or incorrect.

**Fix:** Each nav item should check `isFeatureEnabled(feature)` — see Sidebar Navigation section above.

### "Admin already exists" error on `/admin/setup`

**Cause:** An admin user already exists in the database.

**Fix:** This is expected behavior. Use `/admin/login` instead. If you need to reset, delete the admin user from the database:

```sql
DELETE FROM user_credential WHERE email = '<admin-email>';
DELETE FROM staff WHERE email = '<admin-email>';
```

---

## Professional Navigation Setup

See §2 Step 6 for guidance on adding admin navigation. **Read the existing header, login page, and footer files before adding anything** — a "Staff", "Admin", or "Login" button may already exist. Update existing elements to point to `/admin/login` rather than adding duplicates.

Minimum required: a "Staff Login" button on the customer login page and at least one more entry point (header or footer). Both must be visible, clickable UI elements — never tell the user to type a URL manually.

---

## Dashboard Customization

### Stat Cards

Edit `src/pages/admin/index.tsx` to customize dashboard metrics:

```tsx
<StatCard
  title="Today's Bookings"
  value={stats.todayBookings}
  icon={Calendar}
  trend="+12% from yesterday"
/>
```

### Widgets

Common dashboard widgets:
- **Upcoming Bookings** — next 5-10 bookings
- **Recent Clients** — last 10 clients who booked
- **Revenue Summary** — today/week/month totals
- **Popular Services** — services with most bookings

Each widget is a separate component in `src/components/admin/widgets/`.

---

## API Reference

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/appointments/admin/auth/setup` | First-time admin creation |
| POST | `/api/appointments/admin/auth/login` | Admin login |
| POST | `/api/appointments/admin/auth/logout` | Admin logout |
| GET | `/api/appointments/admin/auth/me` | Get current admin user |
| GET | `/api/appointments/admin/bookings` | List all bookings |
| GET | `/api/appointments/admin/bookings/:id` | Single booking detail |
| PATCH | `/api/appointments/admin/bookings/:id` | Update booking status |
| GET | `/api/appointments/admin/services` | List all services |
| POST | `/api/appointments/admin/services` | Create service |
| PATCH | `/api/appointments/admin/services/:id` | Update service |
| DELETE | `/api/appointments/admin/services/:id` | Delete service |
| GET | `/api/appointments/admin/staff` | List all staff |
| POST | `/api/appointments/admin/staff` | Create staff member |
| PATCH | `/api/appointments/admin/staff/:id` | Update staff member |
| DELETE | `/api/appointments/admin/staff/:id` | Delete staff member |
| GET | `/api/appointments/admin/clients` | List all clients |
| GET | `/api/appointments/admin/clients/:id` | Single client detail |
| GET | `/api/appointments/admin/coupons` | List all coupons |
| POST | `/api/appointments/admin/coupons` | Create coupon |
| PATCH | `/api/appointments/admin/coupons/:id` | Update coupon |
| DELETE | `/api/appointments/admin/coupons/:id` | Delete coupon |
| GET | `/api/appointments/admin/categories` | List all categories |
| POST | `/api/appointments/admin/categories` | Create category |
| GET | `/api/appointments/admin/business-settings` | Get business settings |
| PATCH | `/api/appointments/admin/business-settings` | Update business settings |
| GET | `/api/appointments/admin/availability` | Get business hours |
| PATCH | `/api/appointments/admin/availability` | Update business hours |


---

## Next — load these sections now

Admin system is set up. Immediately load the following before continuing:

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/15-authentication' })
skill({ action: 'loadReference', path: 'online-appointments/sections/17-ui-design' })
```

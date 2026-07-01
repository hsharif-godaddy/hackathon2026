# §15 Authentication

Two separate authentication systems: customer auth (email-only lookup) and admin auth (token-based). They do not overlap and use different storage mechanisms.

---

## Overview

| Aspect | Customer Auth | Admin Auth |
|---|---|---|
| **Purpose** | Let customers view their bookings | Let staff manage the system |
| **Method** | Email-only lookup (no password) | Email + password (token-based) |
| **Storage** | Cookie-based session | `localStorage` (token) |
| **Endpoints** | `/api/appointments/customer/...` | `/api/appointments/admin/auth/...` |
| **Context** | `CustomerAuthContext` | `AdminAuthContext` |
| **Feature flag** | `customer.my_bookings` | Always enabled |
| **SSR-safe** | Yes (cookies work on server) | **No** (requires `localStorage` guard) |

**Critical:** These two systems are independent. A customer logging in does NOT give them admin access, and vice versa.

---

## Customer Authentication

### How It Works

Customer auth is **email-only** — no password required. When a customer wants to view their bookings:

1. Customer visits `/login` (customer login page)
2. Enters their email
3. System looks up bookings by email
4. If bookings exist → session created, redirect to `/my-bookings`
5. If no bookings → error message "No bookings found for this email"

**Why no password?** Reduces friction for customers who book infrequently. The tradeoff is that anyone with access to the customer's email can view their bookings.

### Customer Lookup Endpoint

**Correct URL:** `/api/appointments/customer/lookup`

```http
POST /api/appointments/customer/lookup
Content-Type: application/json

{
  "email": "customer@example.com"
}
```

**Response if bookings exist:**

```json
{
  "success": true,
  "customerId": "uuid-here"
}
```

**Response if no bookings:**

```json
{
  "success": false,
  "message": "No bookings found for this email"
}
```

### Customer Session Management

After successful lookup, the server creates a session and sets a cookie:

```
Set-Cookie: customer_session=<session-id>; HttpOnly; Secure; SameSite=Strict
```

Subsequent requests to `/api/appointments/customer/my-bookings` are authenticated via this cookie.

### Customer Auth Context

The `CustomerAuthContext` (in `src/contexts/CustomerAuthContext.tsx`) manages customer login state:

```tsx
import { createContext, useContext, useState, useEffect } from 'react';

interface CustomerAuthContextValue {
  isAuthenticated: boolean;
  customerId: string | null;
  loading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const CustomerAuthContext = createContext<CustomerAuthContextValue | null>(null);

export function CustomerAuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, check if customer session exists
  useEffect(() => {
    fetch('/api/appointments/customer/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.customerId) {
          setIsAuthenticated(true);
          setCustomerId(data.customerId);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string) => {
    const res = await fetch('/api/appointments/customer/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      credentials: 'include',
    });
    const data = await res.json();
    if (data.success) {
      setIsAuthenticated(true);
      setCustomerId(data.customerId);
    } else {
      throw new Error(data.message || 'Login failed');
    }
  };

  const logout = async () => {
    await fetch('/api/appointments/customer/logout', {
      method: 'POST',
      credentials: 'include',
    });
    setIsAuthenticated(false);
    setCustomerId(null);
  };

  return (
    <CustomerAuthContext.Provider value={{ isAuthenticated, customerId, loading, login, logout }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const context = useContext(CustomerAuthContext);
  if (!context) throw new Error('useCustomerAuth must be used within CustomerAuthProvider');
  return context;
}
```

**Important:** Use `credentials: 'include'` in all fetch calls to ensure cookies are sent.

---

## Admin Authentication

### How It Works

Admin auth uses email + password with token-based authentication:

1. Admin visits `/admin/login`
2. Enters email + password
3. Server validates credentials
4. If valid → return JWT token
5. Token stored in `localStorage.setItem('admin_token', token)`
6. Subsequent admin API requests include `Authorization: Bearer <token>` header

### Admin Auth Endpoints

**Correct URL pattern:** `/api/appointments/admin/auth/...`

```http
POST /api/appointments/admin/auth/setup    # First-time admin creation
POST /api/appointments/admin/auth/login    # Login
POST /api/appointments/admin/auth/logout   # Logout
GET  /api/appointments/admin/auth/me       # Get current admin user
```

**Common mistake:** Using `/api/admin/auth/...` — this will return 404.

### Admin Auth Context

The `AdminAuthContext` (in `src/contexts/AdminAuthContext.tsx`) manages admin login state:

```tsx
import { createContext, useContext, useState, useEffect } from 'react';

interface AdminAuthContextValue {
  isAuthenticated: boolean;
  user: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, check if token exists and is valid
  useEffect(() => {
    const token = typeof window === 'undefined' ? null : localStorage.getItem('admin_token');
    if (token) {
      fetch('/api/appointments/admin/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => res.json())
        .then(data => {
          if (data.user) {
            setIsAuthenticated(true);
            setUser(data.user);
          } else {
            // Token invalid, clear it
            localStorage.removeItem('admin_token');
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/appointments/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('admin_token', data.token);
      setIsAuthenticated(true);
      setUser(data.user);
    } else {
      throw new Error(data.message || 'Login failed');
    }
  };

  const logout = async () => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      await fetch('/api/appointments/admin/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    localStorage.removeItem('admin_token');
    setIsAuthenticated(false);
    setUser(null);
  };

  return (
    <AdminAuthContext.Provider value={{ isAuthenticated, user, loading, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return context;
}
```

**Critical SSR guard:** `typeof window === 'undefined' ? null : localStorage.getItem('admin_token')` — this prevents crashes during SSR.

---

## SSR Safety

**Customer auth** uses cookies, which work fine during SSR (Node.js can read request headers).

**Admin auth** uses `localStorage`, which doesn't exist on the server. All `localStorage` access must be guarded:

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

**Where to add guards:**
- `AdminAuthContext` initial state (already handled in example above)
- Any component that directly accesses `localStorage` (avoid this — use `useAdminAuth()` instead)
- Any server-side API route (should never access `localStorage` — use token from request headers)

---

## Provider Tree Setup

Both auth providers must be in the correct order in `src/App.tsx` or `src/RootLayout.tsx`:

```tsx
import { AdminAuthProvider } from './contexts/AdminAuthContext';
import { CustomerAuthProvider } from './contexts/CustomerAuthContext';
import { FeatureFlagsProvider } from './contexts/FeatureFlagsContext';
import { AppConfigProvider } from './contexts/AppConfigContext';
import { RouterProvider } from 'react-router-dom';

export function App() {
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

**Order matters:**
1. `AdminAuthProvider` first (no dependencies)
2. `CustomerAuthProvider` second (no dependencies)
3. `FeatureFlagsProvider` third (depends on API config)
4. `AppConfigProvider` fourth (depends on feature flags)
5. `RouterProvider` last (depends on all contexts)

---

## Protected Routes

### Customer Routes

Use `ProtectedCustomerRoute` to require customer login:

```tsx
import { Navigate } from 'react-router-dom';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';

export function ProtectedCustomerRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useCustomerAuth();

  if (loading) return <Spinner />;
  if (!isAuthenticated) return <Navigate to="/login" />;

  return <>{children}</>;
}
```

Wrap customer routes:

```tsx
{
  path: '/my-bookings',
  element: (
    <ProtectedCustomerRoute>
      <MyBookings />
    </ProtectedCustomerRoute>
  ),
}
```

### Admin Routes

Use `ProtectedAdminRoute` to require admin login:

```tsx
import { Navigate } from 'react-router-dom';
import { useAdminAuth } from '@/contexts/AdminAuthContext';

export function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAdminAuth();

  if (loading) return <Spinner />;
  if (!isAuthenticated) return <Navigate to="/admin/login" />;

  return <>{children}</>;
}
```

Wrap admin routes:

```tsx
{
  path: '/admin',
  element: (
    <ProtectedAdminRoute>
      <AdminLayout />
    </ProtectedAdminRoute>
  ),
  children: [
    { index: true, element: <AdminDashboard /> },
    { path: 'bookings', element: <AdminBookings /> },
    // ... other admin routes
  ],
}
```

---

## Troubleshooting

### "Cannot read property 'getItem' of undefined"

**Cause:** Accessing `localStorage` during SSR without a guard.

**Fix:** Add `typeof window === 'undefined' ? null : localStorage.getItem('key')` guard.

### Customer login works but bookings page is blank

**Cause:** `credentials: 'include'` missing in fetch calls.

**Fix:** Add `credentials: 'include'` to all customer API fetch calls to ensure cookies are sent.

### Admin API returns 401 even after login

**Cause:** Token not being sent with requests.

**Fix:** Ensure all admin API calls include `Authorization: Bearer ${token}` header. Use `adminApiClient` utility (see §14) instead of raw `fetch()`.

### Admin token expired, stuck in redirect loop

**Cause:** 401 response not clearing token from `localStorage`.

**Fix:** In `adminApiClient` or `AdminAuthContext`, ensure 401 responses call `localStorage.removeItem('admin_token')` before redirecting to login.

### Customer sees "No bookings found" even though they have bookings

**Cause:** Email lookup is case-sensitive.

**Fix:** Normalize email to lowercase in both the booking form and the lookup endpoint:

```typescript
const normalizedEmail = email.toLowerCase().trim();
```

---

## Security Notes

- **Customer auth is less secure** than password-based auth. Anyone with access to the customer's email can view their bookings. This tradeoff prioritizes convenience over security.
- **Admin auth tokens have no expiration** by default. Add token expiration and refresh logic if higher security is needed.
- **Tokens in `localStorage` are vulnerable to XSS**. Ensure all user input is sanitized and no `dangerouslySetInnerHTML` is used in admin pages.
- **Cookies must be HttpOnly** to prevent XSS theft. The `customer_session` cookie should have `HttpOnly; Secure; SameSite=Strict` flags.

---

## API Reference

### Customer Auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/appointments/customer/lookup` | Email-only login |
| POST | `/api/appointments/customer/logout` | Logout (clear session) |
| GET | `/api/appointments/customer/me` | Get current session |
| GET | `/api/appointments/customer/my-bookings` | List customer's bookings |
| GET | `/api/appointments/customer/my-bookings/:id` | Single booking detail |
| DELETE | `/api/appointments/customer/my-bookings/:id` | Cancel booking |

### Admin Auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/appointments/admin/auth/setup` | First-time admin creation |
| POST | `/api/appointments/admin/auth/login` | Login (email + password) |
| POST | `/api/appointments/admin/auth/logout` | Logout (invalidate token) |
| GET | `/api/appointments/admin/auth/me` | Get current admin user |

# Mock Authentication Setup

This document explains how the mock authentication system works for local development.

## Quick Setup

1. **Enable Mock Login** (add to your `.env.local`):
   ```bash
   NODE_ENV=development
   NEXT_PUBLIC_USE_MOCK_LOGIN=true
   ```

2. **Start the app**:
   ```bash
   pnpm run dev
   ```

3. **Use Mock Login**: You'll see a "🚀 Mock Sign In" button instead of regular authentication.

## How it Works

The mock system is designed to be minimal and non-intrusive:

### 1. Authentication Flow
- **Client-Side**: Mock login UI components handle the login/logout experience
- **Server-Side**: Auth validation API (`/api/auth/validate`) returns mock user data when feature flag is enabled

### 2. Integration Points
- **Auth Validation**: `/api/auth/validate` handles mock authentication
- **UI Components**: Mock login dialogs and user switchers
- **Feature Flag**: `isFeatureEnabled.mockLogin()` controls when mock auth is active

## Benefits

- **No Code Pollution**: Mock authentication doesn't spread throughout the codebase
- **Easy Toggle**: Single environment variable to enable/disable
- **Realistic Testing**: Mimics real authentication flow without external dependencies

## Files

- `src/lib/mock-auth.ts` - Core mock authentication manager
- `src/hooks/useMockAuth.ts` - React hook for components
- `src/components/auth/MockLogin.tsx` - UI components
- `src/app/api/auth/validate/route.ts` - Server-side validation

## Environment Variables

```bash
# Required for mock login
NODE_ENV=development
NEXT_PUBLIC_USE_MOCK_LOGIN=true

# Optional - already defaults to test-godaddy.com in dev
NEXT_PUBLIC_SSO_HOST=sso.test-godaddy.com
```
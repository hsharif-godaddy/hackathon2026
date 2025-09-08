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

### 1. Database Seeding
- **Test User Creation**: When mock login is enabled, a test user account is automatically created in the database
- **User Details**: 
  - ID: `dev-user-123`
  - Email: `developer@example.com`
  - Name: `Dev User`  
  - Plan: `Free`

### 2. Authentication Flow
- **Client-Side**: Mock login UI components handle the login/logout experience
- **Server-Side**: Auth validation API (`/api/auth/validate`) returns mock user data when feature flag is enabled
- **Database**: Existing APIs (like `/api/accounts`) work normally since test user exists in database

### 3. Integration Points
- **Auth Validation**: `/api/auth/validate` handles mock authentication
- **Database Seeding**: Test user account is created automatically 
- **UI Components**: Mock login dialogs and user switchers
- **Feature Flag**: `isFeatureEnabled.mockLogin()` controls when mock auth is active

## Benefits

- **No Code Pollution**: Mock authentication doesn't spread throughout the codebase
- **Real Database**: Uses actual database records, so all APIs work normally
- **Easy Toggle**: Single environment variable to enable/disable
- **Realistic Testing**: Mimics real authentication flow without external dependencies

## Files

- `src/lib/mock-auth.ts` - Core mock authentication manager
- `src/hooks/useMockAuth.ts` - React hook for components
- `src/lib/database/seed-test-user.ts` - Database seeding utility
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
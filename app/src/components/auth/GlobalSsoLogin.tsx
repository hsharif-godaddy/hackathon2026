'use client';

import SsoLogin from './SsoLogin';

/**
 * Global SSO Login wrapper for use in server component layouts
 *
 * This client component wrapper allows SsoLogin to be rendered in the
 * root layout (which is a server component). The modal is controlled
 * via the useAuthUIStore Zustand store.
 */
export default function GlobalSsoLogin() {
  return <SsoLogin />;
}


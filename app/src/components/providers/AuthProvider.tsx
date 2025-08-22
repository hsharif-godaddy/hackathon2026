'use client';

import { withAuthProvider } from '@godaddy/gasket-auth';
import { ReactNode } from 'react';

// Simple component that just renders children
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AuthProviderComponent(props: any) {
  const { children } = props;
  return <>{children}</>;
}

// Wrap the component with withAuthProvider HOC to provide auth context
const WrappedAuthProvider = withAuthProvider()(AuthProviderComponent);

// Export the wrapped provider with proper typing
export default function AuthProvider({ children }: { children: ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Provider = WrappedAuthProvider as any;
  return <Provider>{children}</Provider>;
}

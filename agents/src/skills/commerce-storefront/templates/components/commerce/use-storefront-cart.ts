/**
 * Storefront Cart Hook — hook export only
 *
 * Separated from StorefrontShell.tsx to satisfy Vite Fast Refresh rules:
 * a module must export only hooks OR only non-hooks, not both.
 */

import { useContext } from 'react';
import { StorefrontCartContext } from './StorefrontShell';

export function useStorefrontCart() {
  const context = useContext(StorefrontCartContext);

  if (!context) {
    throw new Error('useStorefrontCart must be used within StorefrontShell');
  }

  return context;
}

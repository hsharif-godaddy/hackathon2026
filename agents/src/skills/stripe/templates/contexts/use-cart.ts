/**
 * Cart Hook — hook export only
 *
 * Separated from cart-context.tsx to satisfy Vite Fast Refresh rules:
 * a module must export only hooks OR only non-hooks, not both.
 */

import { useContext } from 'react';
import { CartContext } from './cart-context';

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}

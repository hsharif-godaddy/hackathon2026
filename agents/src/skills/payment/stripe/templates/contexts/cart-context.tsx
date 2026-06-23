/**
 * Cart Context
 *
 * Shared cart state for use across components (header, pages, etc.)
 * Persists cart to localStorage.
 *
 * Usage:
 * 1. Wrap app with <CartProvider> in App.tsx or layout
 * 2. Use useCart() hook in any component
 *
 * Example:
 *   const { cart, addToCart, removeFromCart, cartCount } = useCart();
 *
 * Analytics:
 *   addToCart emits the airo.website.stripe.add_to_cart event (full cart
 *   snapshot) via track() from @/lib/analytics/track. Other cart mutations
 *   (remove/update/clear) are intentionally not tracked — the resulting cart
 *   state is captured by the next snapshot-bearing event (add_to_cart or
 *   checkout_begin).
 */
import { createContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';

import { getFunnelSessionId } from '@/lib/analytics/funnel-session';
import { track } from '@/lib/analytics/track';
import { formatPrice } from '@/lib/stripe/format';

export interface CartItem {
  id: string;
  name: string;
  price: number;
  currency: string;
  priceId: string;
  quantity: number;
  image?: string;
}

export interface AddToCartResult {
  success: boolean;
  error?: string;
}

// Input type for addToCart - accepts string or number id (will be normalized to string)
type AddToCartInput = Omit<CartItem, 'quantity' | 'id'> & { id: string | number; quantity?: number };

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: AddToCartInput) => AddToCartResult;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  cartTotal: number;
  cartCount: number;
}

export const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);

  // Load cart from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('stripe-cart');
    if (saved) {
      try {
        setCart(JSON.parse(saved));
      } catch {
        localStorage.removeItem('stripe-cart');
      }
    }
  }, []);

  // Save cart to localStorage on change
  useEffect(() => {
    localStorage.setItem('stripe-cart', JSON.stringify(cart));
  }, [cart]);

  // All mutators are wrapped in useCallback so consumers can safely
  // depend on them in useEffect deps without triggering re-render loops.
  // Specifically: success.tsx calls clearCart() inside an effect with
  // clearCart in the deps; without useCallback, every clearCart() —
  // which calls setCart([]) — re-renders CartProvider, publishes a new
  // clearCart reference through context, the consumer's deps differ,
  // the effect re-runs, fetches the Stripe session again, calls
  // clearCart() again. Infinite paid-API-call loop. useCallback gives
  // each mutator a stable identity tied to its actual dependencies.

  // Tracks the currency of the last add-to-cart for the analytics effect.
  // Analytics fires from useEffect (after React commits the new cart state)
  // so the payload always reflects the real committed cart — no reliance
  // on React's eager-state optimization.
  const pendingAddCurrencyRef = useRef<string | null>(null);

  useEffect(() => {
    const currency = pendingAddCurrencyRef.current;
    if (!currency || cart.length === 0) return;
    pendingAddCurrencyRef.current = null;

    const quantityTotal = cart.reduce((sum, i) => sum + i.quantity, 0);
    const amountTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

    track('airo.website.stripe.add_to_cart', 'action', 'add_to_cart', {
      page_path: typeof window !== 'undefined' ? window.location.pathname : '/',
      currency,
      line_count: cart.length,
      quantity_total: quantityTotal,
      amount_total: amountTotal,
      amount_total_display: formatPrice(amountTotal, currency),
      line_items_json: JSON.stringify(cart.map((i) => ({
        product_id: i.id,
        name: i.name,
        price_id: i.priceId,
        quantity: i.quantity,
        unit_price_display: formatPrice(i.price, i.currency),
        line_total_display: formatPrice(i.price * i.quantity, i.currency),
      }))),
      funnel_session_id: getFunnelSessionId(),
    });
  }, [cart]);

  const addToCart = useCallback((item: AddToCartInput): AddToCartResult => {
    const normalizedId = String(item.id);
    const addQty = item.quantity ?? 1;

    if (cart.length > 0 && cart[0].currency !== item.currency) {
      return {
        success: false,
        error: `Cannot add items with different currencies to cart. Cart uses ${cart[0].currency.toUpperCase()}.`,
      };
    }

    pendingAddCurrencyRef.current = item.currency;
    setCart((prev) => {
      const existing = prev.find((i) => i.id === normalizedId);
      return existing
        ? prev.map((i) => (i.id === normalizedId ? { ...i, quantity: i.quantity + addQty } : i))
        : [...prev, { ...item, id: normalizedId, quantity: addQty }];
    });

    return { success: true };
  }, [cart]);

  const removeFromCart = useCallback((id: string) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    // Inline the empty-quantity removal rather than calling removeFromCart,
    // so this callback's identity doesn't depend on removeFromCart's.
    if (quantity <= 0) {
      setCart((prev) => prev.filter((i) => i.id !== id));
      return;
    }
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, quantity } : i)));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    localStorage.removeItem('stripe-cart');
  }, []);

  const cartTotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const cartCount = cart.reduce((count, item) => count + item.quantity, 0);

  // Memoize the context value so the object identity is stable when
  // none of its members changed. Without this, every CartProvider
  // re-render publishes a fresh `value={{...}}` literal, forcing every
  // consumer to re-render — and silently breaking any consumer that
  // depends on individual context fields in useEffect deps.
  const value = useMemo<CartContextType>(
    () => ({ cart, addToCart, removeFromCart, updateQuantity, clearCart, cartTotal, cartCount }),
    [cart, addToCart, removeFromCart, updateQuantity, clearCart, cartTotal, cartCount],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}


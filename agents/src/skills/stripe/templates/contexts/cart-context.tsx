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
 */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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

const CartContext = createContext<CartContextType | undefined>(undefined);

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

  const addToCart = (item: AddToCartInput): AddToCartResult => {
    // Normalize id to string (handles both number and string inputs)
    const normalizedId = String(item.id);

    // Validate same currency (Stripe doesn't support multi-currency checkout)
    if (cart.length > 0 && cart[0].currency !== item.currency) {
      return {
        success: false,
        error: `Cannot add items with different currencies to cart. Cart uses ${cart[0].currency.toUpperCase()}.`,
      };
    }

    setCart((prev) => {
      const existing = prev.find((i) => i.id === normalizedId);
      const addQty = item.quantity ?? 1;
      if (existing) {
        return prev.map((i) => (i.id === normalizedId ? { ...i, quantity: i.quantity + addQty } : i));
      }
      return [...prev, { ...item, id: normalizedId, quantity: addQty }];
    });

    return { success: true };
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(id);
      return;
    }
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, quantity } : i)));
  };

  const clearCart = () => {
    setCart([]);
    localStorage.removeItem('stripe-cart');
  };

  const cartTotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const cartCount = cart.reduce((count, item) => count + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        cart,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        cartTotal,
        cartCount,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}

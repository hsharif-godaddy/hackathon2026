/**
 * Domain Purchase Types
 *
 * Type definitions for domain search and purchase functionality.
 * Used by DomainPurchaseWidget and related hooks/services.
 */

/**
 * Domain search state
 */
export interface DomainSearchState {
  status: 'idle' | 'loading' | 'success' | 'empty' | 'error';
  domains: Domain[];
  products: Map<number, Product>;
  error: Error | null;
}

/**
 * Cart state
 */
export interface CartState {
  status: 'idle' | 'adding' | 'added' | 'removing' | 'error';
  basketId: string;
  cartCount: number;
  selectedDomain: Domain | null;
  error: Error | null;
}

/**
 * Checkout state
 */
export interface CheckoutState {
  status: 'hidden' | 'visible' | 'processing' | 'complete' | 'error';
  order: Order | null;
  error: Error | null;
}

/**
 * Domain result from search
 */
export interface Domain {
  fqdn: string;
  sld: string;
  tld: string;
  availabilityCode: number;
  productId: number;
  isPremium: boolean;
  isExactMatch: boolean;
  priceDisplay?: string;
  _raw?: Record<string, unknown>; // Original API response for cart payload
}

/**
 * Product pricing info
 */
export interface Product {
  productId: number;
  priceInfo: PriceInfo;
}

/**
 * Price info details
 */
export interface PriceInfo {
  listPrice: number;
  listPriceDisplay: string;
  currentPrice: number;
  currentPriceDisplay: string;
  renewalPrice: number;
  renewalPriceDisplay: string;
  isOnSale: boolean;
}

/**
 * Order result
 */
export interface Order {
  orderId: string;
  items: OrderItem[];
  total: number;
}

/**
 * Order item
 */
export interface OrderItem {
  domain: string;
  price: number;
}

/**
 * Cart result from SAPI
 */
export interface CartResult {
  success: boolean;
  basketId?: string;
  cartCount?: number;
  error?: string;
  message?: string;
}

/**
 * Search pipeline metadata returned by /api/domains/search for spins quality analysis.
 */
export interface DomainSearchMeta {
  /** Whether LLM seeds or the fallback buildSpinsQuery path drove findSpins */
  seedsUsed: 'llm' | 'fallback';
  seedsCount: number;
  spinsFulfilled: number;
  spinsRejected: number;
  /** Domains in the capped response where isExactMatch is false */
  spinsResultCount: number;
  exactMatchCount: number;
  totalBeforeCap: number;
}

/**
 * Domain search result from API (products as array to avoid Map churn)
 */
export interface DomainSearchResult {
  domains: Domain[];
  products: Product[];
  meta?: DomainSearchMeta;
}

/**
 * Domain availability codes
 */
export const AvailabilityCodes = {
  AVAILABLE: 1000,
  AVAILABLE_PREMIUM: 1001,
  AVAILABLE_AFTERMARKET: 1100,
  UNAVAILABLE: 2000,
  UNAVAILABLE_RESERVED: 2001,
} as const;

/**
 * Check if a domain is available based on availability code
 */
export function isDomainAvailable(availabilityCode: number): boolean {
  return (
    availabilityCode === AvailabilityCodes.AVAILABLE ||
    availabilityCode === AvailabilityCodes.AVAILABLE_PREMIUM ||
    availabilityCode === AvailabilityCodes.AVAILABLE_AFTERMARKET
  );
}

/**
 * DomainPurchaseWidget props
 */
export interface DomainPurchaseWidgetProps {
  brandName?: string;
  domain?: string;
  appId?: string;
  onPurchaseComplete?: (domain: string) => void;
  onCancel?: () => void;
  className?: string;
}

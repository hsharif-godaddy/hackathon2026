/**
 * Commerce Client - Frontend utilities for GoDaddy Commerce integration
 *
 * This module provides client-side functions for interacting with Commerce APIs
 * through the backend API routes.
 *
 * @example
 * ```typescript
 * import { createCheckoutSession } from '@/lib/commerce-client';
 *
 * // Single item checkout
 * const result = await createCheckoutSession({
 *   storeId: 'store-123',
 *   lineItems: [{ skuId: '019764de-c4bb-7fff-a81e-04c632565522', quantity: 1 }],
 *   returnUrl: window.location.href,
 *   successUrl: '/checkout/success'
 * });
 *
 * // Multiple items checkout
 * const result = await createCheckoutSession({
 *   storeId: 'store-123',
 *   lineItems: [
 *     { skuId: 'sku-1', quantity: 2 },
 *     { skuId: 'sku-2', quantity: 1 }
 *   ],
 *   returnUrl: window.location.href,
 *   successUrl: '/checkout/success',
 *   storeName: 'My Store',
 *   enableShipping: true
 * });
 *
 * if (result.success) {
 *   window.location.href = result.checkoutUrl;
 * }
 * ```
 */

/**
 * Line item for checkout - represents a product and quantity
 */
export interface LineItem {
	/** SKU ID of the product (from product.skus[].id) */
	skuId: string;
	/** Quantity to purchase */
	quantity: number;
}

/**
 * Base parameters shared by all checkout session types
 */
interface BaseCheckoutSessionParams {
	/** Store ID from Commerce API */
	storeId: string;
	/** URL to return to if checkout is cancelled */
	returnUrl: string;
	/** URL to redirect to after successful payment */
	successUrl: string;
	/** Optional store name to display in checkout */
	storeName?: string;
	/** Enable shipping options */
	enableShipping?: boolean;
	/** Enable local pickup option */
	enableLocalPickup?: boolean;
	/** Enable billing address collection (default: true) */
	enableBillingAddressCollection?: boolean;
	/** Enable shipping address collection */
	enableShippingAddressCollection?: boolean;
	/** Enable phone number collection */
	enablePhoneCollection?: boolean;
	/** Enable tax collection */
	enableTaxCollection?: boolean;
	/** Enable payment method collection (default: true) */
	enablePaymentMethodCollection?: boolean;
}

/**
 * Checkout parameters using line items (for payment flows)
 */
interface LineItemsCheckoutParams extends BaseCheckoutSessionParams {
	/** Array of line items (products and quantities) - used for payment flows */
	lineItems: LineItem[];
	draftOrderId?: never;
}

/**
 * Checkout parameters using draft order ID (for full storefront flow)
 */
interface DraftOrderCheckoutParams extends BaseCheckoutSessionParams {
	/** Draft order ID - used for full storefront flow with @godaddy/react Cart component */
	draftOrderId: string;
	lineItems?: never;
}

/**
 * Request parameters for creating a checkout session
 *
 * Use either:
 * - `lineItems` for payment flows (manual checkout implementation)
 * - `draftOrderId` for storefront flows (using @godaddy/react Cart component)
 */
export type CreateCheckoutSessionParams =
	| LineItemsCheckoutParams
	| DraftOrderCheckoutParams;

/**
 * Response from checkout session creation
 */
export interface CreateCheckoutSessionResponse {
	/** Whether the request was successful */
	success: boolean;
	/** Checkout session ID (if successful) */
	checkoutSessionId?: string;
	/** URL to redirect customer to for payment (if successful) */
	checkoutUrl?: string;
	/** Store ID (if successful) */
	storeId?: string;
	/** Error message (if failed) */
	error?: string;
}

/**
 * Create a checkout session for a product purchase
 *
 * This function calls the backend API route to securely create a checkout session
 * with the GoDaddy Commerce API.
 *
 * @param params - Checkout session parameters
 * @returns Promise resolving to checkout session response
 * @throws Error if the API request fails
 *
 * @example
 * ```typescript
 * const result = await createCheckoutSession({
 *   storeId: 'store-123',
 *   lineItems: [{ skuId: '019764de-c4bb-7fff-a81e-04c632565522', quantity: 1 }],
 *   returnUrl: '/checkout',
 *   successUrl: '/checkout/success'
 * });
 *
 * if (result.success && result.checkoutUrl) {
 *   // Redirect to GoDaddy checkout
 *   window.location.href = result.checkoutUrl;
 * } else {
 *   console.error('Checkout failed:', result.error);
 * }
 * ```
 */
export async function createCheckoutSession(
	params: CreateCheckoutSessionParams,
): Promise<CreateCheckoutSessionResponse> {
	try {
		const response = await fetch("/api/commerce/create-checkout-session", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(params),
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			return {
				success: false,
				error:
					errorData.error ||
					`HTTP error: ${response.status} ${response.statusText}`,
			};
		}

		const data = await response.json();
		return data as CreateCheckoutSessionResponse;
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof Error
					? error.message
					: "Failed to create checkout session",
		};
	}
}

/**
 * Product interface matching Commerce API response
 *
 * IMPORTANT: Use the `skuId` field for all checkout operations.
 * This is the sku.id from the GraphQL API response.
 * DO NOT use other ID fields (code, groupId, etc.) for checkout.
 */
export interface CommerceProduct {
	/**
	 * SKU ID - The ONLY valid identifier for checkout sessions
	 * This is the sku.id from the Commerce GraphQL API
	 */
	skuId: string;
	/** Product title */
	title: string;
	/** Product description */
	description: string;
	/** Price in smallest currency unit (cents for USD) */
	price: number;
	/** Original price if on sale */
	compareAtPrice?: number;
	/** Currency code (e.g., 'USD') */
	currencyCode?: string;
	/** Product label */
	label?: string;
	/** Product name */
	name?: string;
	/** Product code */
	code?: string;
	/** Product status */
	status?: string;
	/** Group ID this product belongs to */
	groupId?: string;
	/** Group label */
	groupLabel?: string;
	/** Group name */
	groupName?: string;
	/** Group description */
	groupDescription?: string;
}

/**
 * Format price for display
 *
 * Converts price from smallest currency unit to display format.
 *
 * @param price - Price in cents (or smallest unit)
 * @param currencyCode - Currency code (default: 'USD')
 * @returns Formatted price string
 *
 * @example
 * ```typescript
 * formatPrice(2999, 'USD') // Returns "$29.99"
 * formatPrice(5000, 'EUR') // Returns "€50.00"
 * ```
 */
export function formatPrice(price: number, currencyCode = "USD"): string {
	const amount = price / 100; // Convert cents to dollars
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currencyCode,
	}).format(amount);
}

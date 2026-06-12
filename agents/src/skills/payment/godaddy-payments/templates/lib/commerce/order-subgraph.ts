/**
 * Minimal GoDaddy Commerce order-storefront-subgraph kit for order status.
 *
 * Used by `get-order-status.ts` to verify the draft order behind a hosted
 * checkout session. Keep this intentionally narrower than the `commerce/ui`
 * cart helpers; payment-only installs should not pull in cart management APIs.
 */

import { type Money } from './gql';

export interface OrderStorefrontEndpointInput {
  apiBaseUrl: string;
}

export interface OrderTotals {
  total?: Money | null;
}

export interface CartOrderStatus {
  status?: string | null;
}

export interface CartLineItem {
  id?: string | null;
  name?: string | null;
  quantity?: number | null;
  skuId?: string | null;
}

export interface CartOrder {
  id?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  statuses?: CartOrderStatus[] | null;
  totals?: OrderTotals | null;
  lineItems?: CartLineItem[] | null;
}

export interface GetOrderStatusVariables {
  id: string;
}

export interface GetOrderStatusResult {
  orderById?: CartOrder | null;
}

export function orderStorefrontEndpoint({ apiBaseUrl }: OrderStorefrontEndpointInput): string {
  return new URL('/v1/commerce/order-storefront-subgraph', apiBaseUrl).toString();
}

export const orderStatusQuery = `
  query GetOrderStatus($id: ID!) {
    orderById(id: $id) {
      id
      createdAt
      updatedAt
      statuses {
        status
      }
      totals {
        total {
          value
          currencyCode
        }
      }
      lineItems {
        id
        name
        quantity
        skuId
      }
    }
  }
`;

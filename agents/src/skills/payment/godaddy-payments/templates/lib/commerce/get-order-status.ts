/**
 * Server-side `getOrderStatus` orchestrator.
 *
 * Queries the GoDaddy order storefront subgraph for the status of a draft
 * order and normalises the result into a flat shape suitable for both the
 * `/api/commerce/order-status` HTTP route and any in-process server caller
 * (e.g. `GoDaddyCommerceProvider`).
 *
 * Uses storefront headers (`X-Store-ID` / `X-Client-ID`) — the same auth
 * path as the cart GET routes. No OAuth Bearer token is required.
 *
 * Server-only. Reads `clientId` and `storeId` from `readCommerceConfig()`.
 * Do not import this file from browser code.
 */

import { readCommerceConfig } from './config';
import { gqlRequest, storefrontHeaders } from './gql';
import {
  orderStatusQuery,
  orderStorefrontEndpoint,
  type GetOrderStatusResult,
  type GetOrderStatusVariables,
} from './order-subgraph';

export interface CommerceOrderStatus {
  /** GoDaddy draft order id. */
  id: string;
  /** Raw status string from GoDaddy (e.g. "PAID", "PENDING"). Case may vary. */
  status: string;
  /** Total amount in the currency's smallest unit (cents for USD). */
  amount: number;
  /** ISO 4217 currency code (e.g. "USD"). */
  currency: string;
  /** ISO 8601 creation timestamp. */
  createdAt?: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt?: string;
  /** Line items on the order. */
  lineItems?: unknown[];
}

export async function getOrderStatus(orderId: string): Promise<CommerceOrderStatus> {
  if (!orderId) {
    throw new Error('getOrderStatus: orderId is required');
  }

  const { storeId, clientId, apiBaseUrl } = readCommerceConfig();

  const data = await gqlRequest<GetOrderStatusResult, GetOrderStatusVariables>({
    endpoint: orderStorefrontEndpoint({ apiBaseUrl }),
    query: orderStatusQuery,
    variables: { id: orderId },
    headers: storefrontHeaders({ storeId, clientId }),
  });

  const order = data.orderById;
  if (!order?.id) {
    throw new Error(`Order not found: ${orderId}`);
  }

  // statuses is an array; the first entry reflects the most recent state.
  // An empty array means the order is brand-new and not yet processed.
  const rawStatus = order.statuses?.[0]?.status ?? 'pending';
  const total = order.totals?.total;

  return {
    id: order.id,
    status: rawStatus,
    amount: total?.value ?? 0,
    currency: total?.currencyCode ?? 'USD',
    createdAt: order.createdAt ?? undefined,
    updatedAt: order.updatedAt ?? undefined,
    lineItems: (order.lineItems ?? []) as unknown[],
  };
}

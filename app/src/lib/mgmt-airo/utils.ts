/**
 * Utility functions for mgmt-airo
 */

import type { AiroOwnerProduct } from './types';
import { AIRO_OWNER_PRODUCTS, AIRO_PRODUCT_IDS } from './types';

/**
 * Mapping from Product IDs to Owner Products
 */
export const PRODUCT_ID_TO_OWNER_PRODUCT: Record<string, AiroOwnerProduct> = {
  [AIRO_PRODUCT_IDS.AAB_V1]: AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER,
  [AIRO_PRODUCT_IDS.PAAS_NODEJS_V1]: AIRO_OWNER_PRODUCTS.PAAS_NODEJS,
};

/**
 * Get the owner product (product family) from a product ID
 * @param productId - The product ID (e.g., 'aab-v1', 'paas-nodejs-v1')
 * @returns The corresponding owner product or undefined if not found
 */
export function getOwnerProductFromProductId(productId: string): AiroOwnerProduct | undefined {
  return PRODUCT_ID_TO_OWNER_PRODUCT[productId];
}

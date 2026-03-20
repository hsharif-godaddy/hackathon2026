export interface CommerceSkillProduct {
  /** SKU ID - required for checkout */
  skuId: string;
  title: string;
  description: string;
  /** Price in smallest currency unit (e.g. cents for USD) */
  price: number;
  currencyCode: string;
  imageUrl?: string;
}

/**
 * Populate from commerce__fetch_catalog tool output.
 * Use sku.id values (not skuGroup/product IDs).
 *
 * Intentionally starts empty so no dummy product data is shipped by default.
 */
export const COMMERCE_PRODUCTS: CommerceSkillProduct[] = [];

export function getCommerceProductBySkuId(skuId: string): CommerceSkillProduct | undefined {
  return COMMERCE_PRODUCTS.find((product) => product.skuId === skuId);
}

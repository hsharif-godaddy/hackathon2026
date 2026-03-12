'use client';
import { ProductGrid } from '@godaddy/react';

export default function ShopPage() {
  return (
    <ProductGrid
      getProductHref={(id) => `/shop/product/${id}`}
      onAddToCartSuccess={() => {}}
    />
  );
}

import { ProductGrid, ProductSearch } from '@godaddy/react';
import { StorefrontShell } from '../../../components/commerce/StorefrontShell';
import { useStorefrontCart } from '../../../components/commerce/use-storefront-cart';

function CatalogContent() {
  const { openCart } = useStorefrontCart();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">Shop</h1>
      <div className="mb-6 max-w-md">
        <ProductSearch />
      </div>
      <ProductGrid
        enablePagination
        getProductHref={(id) => `/shop/product/${id}`}
        onAddToCartSuccess={openCart}
      />
    </div>
  );
}

export default function CommerceStorefrontCatalogPage() {
  return (
    <StorefrontShell>
      <CatalogContent />
    </StorefrontShell>
  );
}

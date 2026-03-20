import { ProductDetails } from '@godaddy/react';
import { useParams } from 'react-router-dom';
import { StorefrontShell, useStorefrontCart } from '../../../components/commerce/StorefrontShell';

function ProductContent({ productId }: { productId: string }) {
  const { openCart } = useStorefrontCart();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <ProductDetails productId={productId} onAddToCartSuccess={openCart} />
    </div>
  );
}

export default function CommerceStorefrontProductPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <StorefrontShell>
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-2xl font-bold">Product not found</h1>
        </div>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <ProductContent productId={id} />
    </StorefrontShell>
  );
}

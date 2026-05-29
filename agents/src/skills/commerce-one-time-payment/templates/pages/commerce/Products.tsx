import { Link } from 'react-router-dom';
import { COMMERCE_PRODUCTS } from '../../lib/commerce/products';
import { formatPrice } from '../../lib/commerce-client';

export default function CommerceProductsPage() {
  if (COMMERCE_PRODUCTS.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">No products available</h1>
        <p className="mt-2 text-gray-600">
          Add products in <code>src/lib/commerce/products.ts</code> using SKU IDs from Commerce.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold">Products</h1>
      <p className="mt-2 text-gray-600">Select a product to start checkout.</p>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {COMMERCE_PRODUCTS.map((product) => (
          <article key={product.skuId} className="rounded-xl border bg-white p-4 shadow-sm">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.title}
                className="mb-4 h-44 w-full rounded-lg object-cover"
              />
            ) : null}

            <h2 className="text-lg font-semibold">{product.title}</h2>
            <p className="mt-2 text-sm text-gray-600">{product.description}</p>

            <div className="mt-3 text-sm text-gray-500">
              SKU ID: <code className="rounded bg-gray-100 px-1 py-0.5">{product.skuId}</code>
            </div>

            <div className="mt-4 text-xl font-bold">
              {formatPrice(product.price, product.currencyCode)}
            </div>

            <Link
              to={`/checkout/${product.skuId}`}
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-black px-4 py-2 text-white hover:bg-gray-800"
            >
              Buy Now
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}

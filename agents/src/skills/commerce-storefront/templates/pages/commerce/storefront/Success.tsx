import { Link, useSearchParams } from 'react-router-dom';

export default function CommerceStorefrontSuccessPage() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Checkout Complete</h1>
        <p className="mt-3 text-gray-600">Thanks for your purchase.</p>
        {orderId && (
          <p className="mt-2 text-sm text-gray-500">Order ID: {orderId}</p>
        )}

        <div className="mt-8">
          <Link
            to="/shop"
            className="inline-flex items-center justify-center rounded-lg bg-black px-5 py-2 text-white hover:bg-gray-800"
          >
            Back to Shop
          </Link>
        </div>
      </div>
    </div>
  );
}

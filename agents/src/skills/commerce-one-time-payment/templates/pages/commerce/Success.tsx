import { Link } from 'react-router-dom';

export default function CommerceCheckoutSuccessPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Payment Successful</h1>
        <p className="mt-3 text-gray-600">
          Thank you for your purchase. Your checkout has been completed successfully.
        </p>

        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            to="/products"
            className="inline-flex items-center justify-center rounded-lg bg-black px-5 py-2 text-white hover:bg-gray-800"
          >
            Continue Shopping
          </Link>
          <Link to="/" className="underline">
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}

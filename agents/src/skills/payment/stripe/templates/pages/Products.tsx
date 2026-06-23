/**
 * Products Page
 *
 * Displays products with Stripe checkout integration.
 *
 * IMPORTANT: Products are EMBEDDED below, not fetched from API.
 * To update products: use Stripe MCP tools (e.g. `stripe-v2__list_products`,
 * `stripe-v2__create_product`, `stripe-v2__create_price`) and paste the
 * returned values into PRODUCTS below. Match the Product interface exactly
 * — `id`, `priceId`, `images: string[]`, `amount` (smallest currency unit),
 * `currency`, and `recurring: {interval, intervalCount} | null`.
 *
 * Features:
 * - Product cards with "Add to Cart" and "Buy Now" buttons
 * - Click card to view full details in modal/dialog
 * - Cart icon links to /cart page
 * - Checkout available from card and detail modal
 *
 * Note: Requires CartProvider wrapper in App.tsx or layout.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useCart } from '../contexts/use-cart';
import { startTrackedCheckout } from '../lib/analytics/checkout';
import { formatPrice } from '../lib/stripe/format';

const ENABLE_CART = true;

interface Product {
  id: string;
  name: string;
  description: string | null;
  images: string[];
  priceId: string;
  amount: number;
  currency: string;
  recurring: {
    interval: string;
    intervalCount: number;
  } | null;
}

/**
 * EMBEDDED PRODUCTS
 *
 * Replace this array with your actual products from Stripe.
 * Get product data via Stripe MCP tools (e.g. `stripe-v2__list_products`).
 *
 * Required fields:
 * - id: Stripe product ID (prod_xxx)
 * - priceId: Stripe price ID (price_xxx) - REQUIRED for checkout
 * - amount: Price in smallest currency unit (e.g., 4500 for $45.00 or ₹45.00)
 * - currency: Currency code (e.g., 'usd', 'inr')
 *
 * Example:
 * {
 *   id: 'prod_ABC123',
 *   name: 'Premium Plan',
 *   description: 'Full access to all features',
 *   images: ['/images/product.jpg'],
 *   priceId: 'price_XYZ789',  // ← This is used for Stripe checkout
 *   amount: 2999,              // ← $29.99 in cents
 *   currency: 'usd',
 *   recurring: { interval: 'month', intervalCount: 1 }  // or null for one-time
 * }
 */
const PRODUCTS: Product[] = [
  // TODO: Replace with your actual products from Stripe.
  // Get product data via Stripe MCP tools (e.g. stripe-v2__list_products),
  // then paste the products array here matching the Product interface above.
];

export default function Products() {
  const { t } = useTranslation();
  // Per-action error state — never replace the whole grid with one error.
  // addError surfaces near the product whose Add-to-Cart failed; checkoutError
  // surfaces near the product whose Buy-Now failed. A failure on one row
  // must not affect any other row's render.
  const [addError, setAddError] = useState<{ productId: string; message: string } | null>(null);
  const [checkoutError, setCheckoutError] = useState<{ productId: string; message: string } | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { addToCart: addToCartContext, cartCount } = useCart();

  // Use embedded products (no API fetch needed)
  const products = PRODUCTS;
  const loading = false;

  const handleAddToCart = (product: Product) => {
    setAddError(null);
    setCheckoutError(null);
    const result = addToCartContext({
      id: product.id,
      name: product.name,
      price: product.amount,
      currency: product.currency,
      priceId: product.priceId,
      image: product.images[0],
    });

    if (!result.success) {
      setAddError({ productId: product.id, message: result.error || 'Failed to add item to cart' });
    }
  };

  const handleCheckout = async (product: Product) => {
    setAddError(null);
    setCheckoutError(null);
    setCheckingOut(product.priceId);

    const result = await startTrackedCheckout('products_buy_now', [{
      productId: product.id,
      name: product.name,
      priceId: product.priceId,
      amount: product.amount,
      currency: product.currency,
      quantity: 1,
    }]);

    if (!result.success) {
      setCheckoutError({ productId: product.id, message: result.error ?? 'Failed to create checkout session' });
      setCheckingOut(null);
    }
  };

  // Using shared formatPrice utility from lib/stripe/format.ts
  // Handles zero-decimal currencies (JPY, KRW, etc.) correctly

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('stripe.no_products_title')}</h2>
          <p className="text-gray-600">{t('stripe.no_products_message')}</p>
        </div>
      </div>
    );
  }

  const openProductDialog = (product: Product) => {
    setSelectedProduct(product);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setTimeout(() => setSelectedProduct(null), 200);
  };

  return (
    <>
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        {/* Cart Button - Links to /cart page */}
        {ENABLE_CART && (
          <Link
            to="/cart"
            className="fixed top-20 right-4 z-40 bg-blue-600 text-white rounded-full p-4 shadow-lg hover:bg-blue-700 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            {/* Badge - only shows when items in cart */}
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </Link>
        )}

        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-3xl font-bold text-gray-900">{t('stripe.page_title')}</h1>
            <p className="mt-2 text-gray-600">{t('stripe.page_subtitle')}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {products.map((product) => (
              <div
                key={product.id}
                className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow overflow-hidden"
              >
                {/* Product Image */}
                <div
                  onClick={() => openProductDialog(product)}
                  className="cursor-pointer"
                >
                  {product.images[0] ? (
                    <img
                      src={product.images[0]}
                      alt={product.name}
                      className="w-full h-48 object-cover hover:opacity-90 transition-opacity"
                    />
                  ) : (
                    <div className="w-full h-48 bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
                      <svg
                        className="w-16 h-16 text-gray-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1}
                          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                        />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Product Details */}
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{product.name}</h3>

                  {product.description && (
                    <p className="text-gray-600 text-sm mb-4 line-clamp-2">{product.description}</p>
                  )}

                  {/* Price */}
                  <div className="flex items-baseline mb-4">
                    <span className="text-2xl font-bold text-gray-900">
                      {formatPrice(product.amount, product.currency)}
                    </span>
                    {product.recurring && (
                      <span className="ml-1 text-gray-500">/{product.recurring.interval}</span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-2">
                    <button
                      onClick={() => openProductDialog(product)}
                      className="w-full py-2 px-4 rounded-lg font-medium border-2 border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      {t('stripe.btn_view_details')}
                    </button>
                    {ENABLE_CART ? (
                      // Show "Add to Cart" + "Buy Now"
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAddToCart(product)}
                          className="flex-1 py-3 px-4 rounded-lg font-medium border-2 border-blue-600 text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          {t('stripe.btn_add_to_cart')}
                        </button>
                        <button
                          onClick={() => handleCheckout(product)}
                          disabled={checkingOut === product.priceId}
                          className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                            checkingOut === product.priceId
                              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                        >
                          {checkingOut === product.priceId ? (
                            <span className="flex items-center justify-center">
                              <svg
                                className="animate-spin -ml-1 mr-2 h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                />
                              </svg>
                              ...
                            </span>
                          ) : product.recurring ? (
                            t('stripe.btn_subscribe')
                          ) : (
                            t('stripe.btn_buy_now')
                          )}
                        </button>
                      </div>
                    ) : (
                      // Fallback: Show only "Subscribe" / "Buy Now"
                      <button
                        onClick={() => handleCheckout(product)}
                        disabled={checkingOut === product.priceId}
                        className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
                          checkingOut === product.priceId
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        {checkingOut === product.priceId ? (
                          <span className="flex items-center justify-center">
                            <svg
                              className="animate-spin -ml-1 mr-2 h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              />
                            </svg>
                            {t('stripe.btn_processing')}
                          </span>
                        ) : product.recurring ? (
                          t('stripe.btn_subscribe_now')
                        ) : (
                          t('stripe.btn_buy_now')
                        )}
                      </button>
                    )}
                  </div>

                  {/* Per-product inline errors. Never replaces the grid. */}
                  {addError?.productId === product.id && (
                    <p className="mt-2 text-sm text-red-600" role="alert">{addError.message}</p>
                  )}
                  {checkoutError?.productId === product.id && (
                    <p className="mt-2 text-sm text-red-600" role="alert">{checkoutError.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Product Detail Dialog */}
      {isDialogOpen && selectedProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          onClick={closeDialog}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Dialog Header */}
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">{selectedProduct.name}</h2>
              <button
                onClick={closeDialog}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Dialog Content */}
            <div className="p-6">
              {/* Product Image */}
              {selectedProduct.images[0] && (
                <img
                  src={selectedProduct.images[0]}
                  alt={selectedProduct.name}
                  className="w-full h-64 object-cover rounded-lg mb-6"
                />
              )}

              {/* Price */}
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-bold text-gray-900">
                  {formatPrice(selectedProduct.amount, selectedProduct.currency)}
                </span>
                {selectedProduct.recurring && (
                  <span className="ml-2 text-xl text-gray-500">
                    /{selectedProduct.recurring.interval}
                  </span>
                )}
                {selectedProduct.recurring && (
                  <span className="ml-2 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                    {t('stripe.badge_subscription')}
                  </span>
                )}
              </div>

              {/* Description */}
              {selectedProduct.description && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('stripe.modal_description_title')}</h3>
                  <p className="text-gray-600 leading-relaxed">{selectedProduct.description}</p>
                </div>
              )}

              {/* Checkout Button */}
              <button
                onClick={() => {
                  closeDialog();
                  handleCheckout(selectedProduct);
                }}
                disabled={checkingOut === selectedProduct.priceId}
                className={`w-full py-4 px-6 rounded-lg font-medium text-lg transition-colors ${
                  checkingOut === selectedProduct.priceId
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {checkingOut === selectedProduct.priceId ? (
                  <span className="flex items-center justify-center">
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    {t('stripe.btn_processing')}
                  </span>
                ) : selectedProduct.recurring ? (
                  t('stripe.btn_subscribe_now')
                ) : (
                  t('stripe.btn_buy_now')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

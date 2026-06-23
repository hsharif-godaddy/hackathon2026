/**
 * Cart Page
 *
 * Displays cart items with quantity controls and checkout.
 * Uses shared CartContext for state management.
 *
 * Route: /cart
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useCart } from '@/contexts/use-cart';
import { startTrackedCheckout } from '@/lib/analytics/checkout';
import { formatPrice } from '@/lib/stripe/format';

export default function CartPage() {
  const { t } = useTranslation();
  const { cart, removeFromCart, updateQuantity, clearCart, cartTotal, cartCount } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    setCheckingOut(true);
    setError(null);

    // Cart is cleared on the verified-success page, NOT here. If we cleared
    // before redirect and the user cancels at Stripe, /checkout/cancel would
    // lie about "your cart items are still saved".
    const result = await startTrackedCheckout('cart', cart.map((item) => ({
      productId: item.id,
      name: item.name,
      priceId: item.priceId,
      amount: item.price,
      currency: item.currency,
      quantity: item.quantity,
    })));

    if (!result.success) {
      setError(result.error ?? 'Failed to create checkout session');
      setCheckingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-4"
          >
            <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t('stripe.link_continue_shopping')}
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">{t('stripe.cart_title')}</h1>
          <p className="text-gray-600 mt-1">{cartCount} {cartCount === 1 ? t('stripe.item_singular') : t('stripe.items_plural')}</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {cart.length === 0 ? (
          /* Empty Cart */
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('stripe.empty_cart_title')}</h2>
            <p className="text-gray-600 mb-6">{t('stripe.empty_cart_message')}</p>
            <Link
              to="/"
              className="inline-block px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t('stripe.btn_browse_store')}
            </Link>
          </div>
        ) : (
          <>
            {/* Cart Items */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6">
              {cart.map((item, index) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-4 p-6 ${index > 0 ? 'border-t border-gray-100' : ''}`}
                >
                  {/* Product Image */}
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-24 h-24 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="w-24 h-24 bg-gray-100 rounded-lg flex items-center justify-center">
                      <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                  )}

                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{item.name}</h3>
                    <p className="text-gray-600">{formatPrice(item.price, item.currency)}</p>
                  </div>

                  {/* Quantity Controls */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-300 hover:bg-gray-50 text-lg font-medium text-gray-900"
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-semibold text-lg text-gray-900">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-300 hover:bg-gray-50 text-lg font-medium text-gray-900"
                    >
                      +
                    </button>
                  </div>

                  {/* Subtotal */}
                  <div className="text-right min-w-[100px]">
                    <p className="font-bold text-gray-900">
                      {formatPrice(item.price * item.quantity, item.currency)}
                    </p>
                  </div>

                  {/* Remove Button */}
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove item"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* Order Summary */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('stripe.order_summary_title')}</h2>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-gray-600">
                  <span>{t('stripe.subtotal_label')} ({cartCount} {cartCount === 1 ? t('stripe.item_singular') : t('stripe.items_plural')})</span>
                  <span>{formatPrice(cartTotal, cart[0]?.currency || 'usd')}</span>
                </div>
                <div className="border-t pt-3 flex justify-between text-xl font-bold text-gray-900">
                  <span>{t('stripe.total_label')}</span>
                  <span>{formatPrice(cartTotal, cart[0]?.currency || 'usd')}</span>
                </div>
              </div>

              <button
                onClick={handleCheckout}
                disabled={checkingOut}
                className={`w-full py-4 px-6 rounded-lg font-medium text-lg transition-colors ${
                  checkingOut
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {checkingOut ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {t('stripe.btn_processing')}
                  </span>
                ) : (
                  t('stripe.btn_proceed_to_checkout')
                )}
              </button>

              <button
                onClick={clearCart}
                className="w-full mt-3 py-2 text-gray-500 hover:text-red-500 text-sm transition-colors"
              >
                {t('stripe.btn_clear_cart')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


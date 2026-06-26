# Enhance an Existing Product Page (Step 5, Option B)

Use this when the app already has a product/pricing page. The goal is to add Stripe checkout to what's there, not rebuild it.

## Rules

1. Do not replace existing product data.
2. Do not change or recreate product cards.
3. Use products embedded in code, not a runtime API fetch.
4. If a cart already exists, enhance it with Stripe checkout — do not create a second one.
5. If a checkout already exists, wire Stripe to the existing checkout button — do not create a second one.
6. Only add: `priceId`, Stripe checkout calls, a View Details button, and the Detail Modal.

Before adding cart/checkout, check what the app already has:

- Cart icon/button → wire it to link to `/cart`.
- "Checkout" button → add the Stripe checkout call to the existing button.
- Cart page → enhance it; don't duplicate.

## Routes

```tsx
{ path: '/cart', element: <CartPage /> },
{ path: '/checkout/success', element: <CheckoutSuccess /> },
{ path: '/checkout/cancel', element: <CheckoutCancel /> },
```

## Map priceId onto existing products (keep the app's images)

```tsx
const products = existingProducts.map((p) => ({ ...p, priceId: stripePriceIds[p.name] }));
```

## B1. State

```tsx
const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
const [isDialogOpen, setIsDialogOpen] = useState(false);
```

## B2. Checkout function

Call the installed `startTrackedCheckout()` helper — do not hand-write the `fetch`. The helper fires the commerce-funnel events (`checkout_begin` → `checkout_redirect` / `checkout_error`), saves the funnel snapshot, and redirects to Stripe. Hand-writing the fetch silently drops those events, so the enhanced page would not match the `Products.tsx` template (Option A).

```tsx
import { startTrackedCheckout } from '@/lib/analytics/checkout';

const handleCheckout = async (product: Product) => {
  const result = await startTrackedCheckout('products_buy_now', [{
    productId: product.id,
    name: product.name,
    priceId: product.priceId,
    amount: product.amount,   // smallest currency unit (e.g. 2999 = $29.99)
    currency: product.currency,
    quantity: 1,
  }]);
  if (!result.success) {
    // Surface result.error via the page's existing error state, e.g. setError(result.error).
  }
};
```

## B3. View Details button on every card

```tsx
<button
  onClick={() => {
    setSelectedProduct(product);
    setIsDialogOpen(true);
  }}
>
  View Details
</button>
```

Style it to match existing buttons and keep it responsive — it must not overflow the card. After wiring, search the file for "View Details"; if it's not there, the card was missed.

## B4. Buy/Subscribe button

```tsx
<button onClick={() => handleCheckout(product)}>Buy Now</button>
```

## B5. Detail Modal (at end of component)

Import `formatPrice` from `@/lib/stripe/format` only. Do not import from `@/lib/stripe/stripe` — that path pulls Node deps into the browser bundle.

```tsx
import { formatPrice } from '@/lib/stripe/format';
```

```tsx
{
  isDialogOpen && selectedProduct && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-2xl font-bold">{selectedProduct.name}</h2>
          <button onClick={() => setIsDialogOpen(false)}>✕</button>
        </div>
        {selectedProduct.images[0] && (
          <img src={selectedProduct.images[0]} className="w-full h-48 object-cover rounded-lg mb-4" />
        )}
        <p className="text-gray-600 mb-4">{selectedProduct.description}</p>
        <p className="text-3xl font-bold mb-6">
          {formatPrice(selectedProduct.amount, selectedProduct.currency)}
        </p>
        <button
          onClick={() => {
            setIsDialogOpen(false);
            handleCheckout(selectedProduct);
          }}
          className="w-full py-3 bg-blue-600 text-white rounded-lg"
        >
          {selectedProduct.recurring ? 'Subscribe Now' : 'Buy Now'}
        </button>
      </div>
    </div>
  );
}
```

## B6. Cart

Check what the app already has, then:

- **Full cart exists** — wire the existing checkout button to `startTrackedCheckout('cart', items)`, mapping each cart entry to `{ productId, name, priceId, amount (smallest currency unit), currency, quantity }`. Don't hand-write the fetch/track. Keep the existing UI. Still add the success/cancel routes above.
- **Partial (cart icon, no cart page)** — keep the existing icon, wire it to `<Link to="/cart">`, use the installed `cart.tsx` page, and wrap the app with `<CartProvider>`.
- **No cart at all** — use the installed `cart-context.tsx` for state, wrap the app with `<CartProvider>`, and add a cart icon to the header linking to `/cart`.

`CartProvider` wrapping and the cart-icon snippet are in the main skill flow ("CartProvider placement" and "Cart icon") — both apply here too.

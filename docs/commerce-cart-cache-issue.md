# Commerce Cart Cache Issue

## Problem Summary

When users add an item to the cart for the **first time** after the app loads, the item does not appear in the cart UI until the page is refreshed. Subsequent adds work correctly and show items immediately.

## Reproduction Steps

1. Create a new commerce-enabled app
2. Navigate to the storefront (homepage or shop page)
3. Click "Add to Cart" on a product (first time)
4. Open the cart component
5. **Expected**: Item appears in cart
6. **Actual**: Cart appears empty until page is refreshed

## Observed Behavior Pattern

- **First add**: Item doesn't appear until page refresh
- **Second add**: Item appears immediately
- **After clearing cart + page refresh**: First add works correctly again

This suggests a **race condition** or **lazy initialization** issue rather than a complete failure of the invalidation mechanism.

## Current Implementation

Generated apps currently implement cart cache invalidation using:

```typescript
import { useQueryClient } from '@tanstack/react-query';

// In ProductGrid or ProductDetails component
const queryClient = useQueryClient();

<ProductGrid
  onAddToCartSuccess={() => {
    queryClient.invalidateQueries({ queryKey: ['cart'] });
  }}
/>
```

## Root Cause Hypothesis

The `@godaddy/react` Cart component likely uses **lazy query initialization**, meaning:

1. The cart query is not created until the Cart component is first rendered/opened
2. When `onAddToCartSuccess` fires on the very first add, `invalidateQueries({ queryKey: ['cart'] })` has no effect because no cart query exists yet
3. Once the cart has been opened at least once, the query exists and subsequent invalidations work

## Attempted Fixes

### Attempt 1: Invalidate all queries (Did not fully test)

```typescript
onAddToCartSuccess={() => {
  queryClient.invalidateQueries();  // No query key filter
}
```

**Status**: Partially implemented in prompts, then reverted. Not confirmed if this resolves the issue.

### Attempt 2: Add refetchQueries (Not tested)

```typescript
onAddToCartSuccess={() => {
  queryClient.invalidateQueries();
  queryClient.refetchQueries();
}
```

**Status**: Not tested. `refetchQueries()` won't help if the query doesn't exist yet.

## Potential Solutions to Explore

### Solution 1: Prefetch Cart Data on App Mount

Add cart prefetching in `StoreProviders` or `RootLayout` to ensure the query exists before any add-to-cart actions:

```typescript
// In StoreProviders.tsx or RootLayout.tsx
useEffect(() => {
  // Force cart query to initialize on mount
  queryClient.prefetchQuery({ queryKey: ["cart"], queryFn: fetchCart });
}, []);
```

**Challenge**: Need to know the exact query key and query function used internally by `@godaddy/react`.

### Solution 2: Use Cart Hook for Initialization

If `@godaddy/react` exports a cart hook (e.g., `useCart`), call it in a high-level component to force initialization:

```typescript
// In RootLayout.tsx
import { useCart } from "@godaddy/react";

function RootLayout({ children }) {
  useCart(); // Initialize cart query on mount
  // ... rest of component
}
```

**Challenge**: Need to verify if such a hook exists and if calling it has side effects.

### Solution 3: Force Query Creation in onAddToCartSuccess

Explicitly ensure the query exists before invalidating:

```typescript
onAddToCartSuccess={() => {
  // Ensure query exists
  queryClient.setQueryData(['cart'], (old) => old ?? null);
  // Then invalidate
  queryClient.invalidateQueries({ queryKey: ['cart'] });
}
```

**Challenge**: Need correct query key and might create stale placeholder data.

### Solution 4: Invalidate + Manual Refetch with Error Handling

```typescript
onAddToCartSuccess={async () => {
  await queryClient.invalidateQueries();
  await queryClient.refetchQueries({
    predicate: (query) => query.queryKey.includes('cart')
  });
}
```

## Investigation Needed

1. **Query Key Discovery**: What query key does `@godaddy/react` Cart component actually use?
   - Is it `['cart']`, `['cart', storeId]`, or something else?
   - Tool: React Query DevTools in browser

2. **Library Exports**: Does `@godaddy/react` export any cart-related hooks?
   - `useCart`, `useCartItems`, etc.
   - Tool: Check package exports or documentation

3. **Initialization Timing**: When exactly does the Cart component create its query?
   - On mount? On first open? Lazy when data is accessed?
   - Tool: React DevTools + React Query DevTools

4. **Library Documentation**: Official guidance on cart cache management
   - Check for recommended patterns from `@godaddy/react` team

## Test Cases for Solution Validation

1. **Clean state test**:
   - Hard refresh page
   - Add first item to cart
   - Open cart immediately
   - ✅ Item should appear without page refresh

2. **Multiple adds test**:
   - Add first item (verify it appears)
   - Add second item
   - ✅ Both items should appear

3. **Clear and re-add test**:
   - Clear all items from cart
   - Add new item
   - ✅ Item should appear

4. **Navigation test**:
   - Add item on homepage
   - Navigate to product detail page
   - Add different item
   - ✅ Both items should appear in cart

## Files Affected

When implementing the fix, these files will need updates:

- `agents/src/prompts/commerce/core.md` - Core Commerce component usage guidance
- `agents/src/prompts/develop/commerce-checkout-guide.md` - Detailed checkout implementation guide
- Potentially `app-templates/v8/src/components/StoreProviders.tsx` if initialization changes needed

## Related Issues

- PR #835: Commerce Orders feature (cart changes reverted to keep PR focused)
- The issue was discovered during testing of app `dced99b8-747e-465d-a060-7773d04c8252`
- Previously tested fix in app `3e81c6af-1b6d-4713-affb-8ab83fb31363` (user reported it worked)

## Next Steps

1. Create new branch for cart cache fix
2. Use React Query DevTools to identify exact query key used by `@godaddy/react`
3. Implement and test Solution 1 or 2 (prefetch approach)
4. Validate with all test cases above
5. Update prompts with working solution
6. Create PR separate from orders feature

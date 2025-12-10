# Testing Guidelines for /app

## Core Principles

### 1. **Don't Mock Internal Components**

- **DO NOT** mock React components from the same codebase (e.g., `HeroSection`, `Header`, `AppCard`)
- **ONLY** mock external dependencies (e.g., `next/navigation`, `@/lib/gasket-config`, API calls)
- Testing mocked components is worthless - test the actual component behavior instead

```typescript
// ❌ BAD - Mocking internal components
vi.mock('@/app/components/HeroSection', () => ({
  default: () => <div>Mock HeroSection</div>
}));

// ✅ GOOD - Only mock external dependencies
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
}));
```

### 2. **Be DRY - Use Centralized Mocks**

- All common mocks live in `src/tests/mocks.ts` and you should prioritize using these
- Never duplicate mock implementations across test files
- If you find yourself writing the same mock twice, add it to `mocks.ts`

```typescript
// ❌ BAD - Duplicating mocks in every test file
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    // ... repeated everywhere
  }),
}));

// ✅ GOOD - Import from centralized mocks
import { mockRouter, mockSearchParams, mockParams } from "@/tests/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter(),
  useSearchParams: () => mockSearchParams(),
  useParams: () => mockParams(),
  usePathname: () => "/",
}));
```

### 3. **Common Setup is Global**

Common test setup lives in `vitest.setup.ts`:

- Console mocks (log, warn, error, etc.)
- Global fetch mock
- `getComputedStyle` fix for pseudo-elements
- `IntersectionObserver` mock (for framer-motion)

**DO NOT** repeat these in individual test files.

### 4. **Test File Structure**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import { mockRouter, mockInstrumentation, mockFeatures } from '@/tests/mocks';
import ComponentToTest from './ComponentToTest';

// Mock external dependencies only
vi.mock('@/lib/gasket-config');
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
  useSearchParams: () => mockSearchParams(),
  useParams: () => mockParams(),
  usePathname: () => '/',
}));
vi.mock('@/utils/instrumentation', () => mockInstrumentation());
vi.mock('@/lib/features', () => mockFeatures());

describe('ComponentToTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('should render without crashing', async () => {
    renderWithProviders(<ComponentToTest />);

    await waitFor(() => {
      expect(document.body).toBeTruthy();
    });
  });

  // More focused tests...
});
```

### 5. **Use `renderWithProviders`**

Always use `renderWithProviders` from `@/tests/test-utils.tsx`:

- Automatically wraps components with QueryClientProvider
- Automatically wraps components with IntlProvider
- Returns `user` for userEvent interactions

```typescript
const { user } = renderWithProviders(<MyComponent />);
await user.click(screen.getByRole('button'));
```

### 6. **Test Behavior, Not Implementation**

Focus on:

- Does the component render?
- Does it handle user interactions correctly?
- Does it handle errors gracefully?
- Are the right events logged?

Avoid:

- Testing internal state implementation details
- Testing component structure/hierarchy
- Testing CSS class names (unless critical for functionality)

### 7. **Targeting Elements**

**Priority for element selection:**

1. **Semantic roles** (when available): `getByRole('button')`, `getByRole('link')`, `getByLabelText('Search')`
2. **data-testid**: `getByTestId('specific-element')`
3. **Text content** (only for unique, stable text): `getByText(/unique text/i)`
4. **Avoid**: CSS selectors, class names

**When to use `data-testid`:**

- Multiple similar elements need differentiation
- Text content is dynamic or internationalized
- Element has no semantic role
- You need to target a specific instance among many

### 8. **Common Testing Patterns**

#### Testing Renders

```typescript
it('should render without crashing', async () => {
  renderWithProviders(<MyComponent />);

  await waitFor(() => {
    expect(document.body).toBeTruthy();
  });
});
```

#### Testing User Interactions

```typescript
it('should handle button click', async () => {
  const { user } = renderWithProviders(<MyComponent />);

  const button = screen.getByRole('button', { name: /Submit/i });
  await user.click(button);

  await waitFor(() => {
    expect(mockFn).toHaveBeenCalled();
  });
});
```

#### Testing Error States

```typescript
it('should handle errors gracefully', async () => {
  vi.mocked(appFetch).mockRejectedValue(new Error('Network error'));

  renderWithProviders(<MyComponent />);

  await waitFor(() => {
    expect(document.body).toBeTruthy();
  });
});
```

#### Testing Store State

```typescript
it('should update store on action', async () => {
  const mockFn = vi.fn();
  useSitesStore.setState({ deleteSite: mockFn });

  const { user } = renderWithProviders(<MyComponent />);

  await user.click(screen.getByRole('button', { name: /Delete/i }));

  await waitFor(() => {
    expect(mockFn).toHaveBeenCalled();
  });
});
```

## Common Errors and Fixes

### "No [export] is defined on the mock"

- Add the missing export to the appropriate mock in `src/tests/mocks.ts`
- Common Next.js exports: `useRouter`, `useSearchParams`, `useParams`, `usePathname`
- Make sure all exports from the mocked module are present

## Running Tests

```bash
# Run all tests
pnpm --filter website test

# Run specific test file
pnpm --filter website test src/app/page.test.tsx

# Run tests in watch mode
pnpm --filter website test --watch

# Run tests with coverage
pnpm --filter website test --coverage
```

## What NOT to Do

1. ❌ **Don't mock internal components** - Test them as-is
2. ❌ **Don't duplicate mocks** - Use `src/tests/mocks.ts`
3. ❌ **Don't repeat global setup** - Use `vitest.setup.ts`
4. ❌ **Don't test implementation details** - Test behavior
5. ❌ **Don't forget to clear mocks** - Use `beforeEach(() => vi.clearAllMocks())`
6. ❌ **Don't forget to import '@testing-library/jest-dom'** - Needed for matchers like `toBeInTheDocument()`

## Examples

See these test files for reference:

- `src/app/page.test.tsx` - Homepage tests
- `src/app/apps/page.test.tsx` - Sites page tests
- `src/app/apps/AppCard.test.tsx` - Component tests with user interactions
- `src/app/apps/AppThumbnail.test.tsx` - Component tests with mocked fetch

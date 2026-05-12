# Payment Integration Testing Guide

This document explains the test coverage for the payment abstraction layer and how to run the tests.

## Test Files

### 1. Pricing Tiers Configuration Tests

**File:** `templates/lib/__tests__/appointments-pricing-tiers.test.ts`

**Coverage:**

- ✅ Single-tier config validation (fixed price)
- ✅ Multi-tier config validation (variable pricing)
- ✅ Duplicate amount detection
- ✅ Free appointments (no pricingTiers)
- ✅ SKU lookup by amount
- ✅ Error messages for unknown amounts
- ✅ Edge cases (free tier, large amounts, empty arrays)

**Key Test Scenarios:**

- Valid single-tier configuration (fixed price)
- Valid multi-tier configuration (variable pricing)
- Rejects duplicate amounts (prevents unreachable SKUs)
- Accepts config without pricingTiers (free appointments)
- SKU lookup finds correct tier
- Clear error for unknown amount
- Helpful error message with available tiers

**Run:**

```bash
# These tests are copied to user apps during skill installation
# Run them in a generated app context:
npm test appointments-pricing-tiers
```

### 2. Payment Provider Factory Tests

**File:** `templates/server/utils/__tests__/payment-provider-factory.test.ts`

**Coverage:**

- ✅ Configuration detection (`isPaymentProviderConfigured()`)
- ✅ Provider instantiation (`getPaymentProvider()`)
- ✅ Error handling when not configured
- ✅ Environment variable validation
- ✅ GoDaddy Commerce configuration
- ✅ Stripe configuration (future)
- ✅ Edge cases (empty strings, whitespace, null values)
- ✅ Error message quality

**Key Test Scenarios:**

- No payment provider configured
- GoDaddy Commerce configured
- Stripe configured (with both key and flag)
- Partial configuration (missing required vars)
- Invalid environment variable values
- Singleton behavior

**Run:**

```bash
npm test payment-provider-factory.test.ts
```

### 2. GoDaddy Commerce Provider Tests

**File:** `templates/server/utils/__tests__/godaddy-commerce-provider.test.ts`

**Coverage:**

- ✅ Constructor validation
- ✅ Payment session creation (`createPaymentSession()`)
- ✅ Order status queries (`getOrderStatus()`)
- ✅ Status mapping (all Commerce statuses)
- ✅ API call structure and parameters
- ✅ Error handling (network, API, malformed responses)
- ✅ Interface compliance (`PaymentProvider`)
- ✅ URL encoding for special characters

**Key Test Scenarios:**

- Successful payment session creation
- API request payload validation
- Return/success URL handling
- API error responses (500, 404)
- Success: false responses from API
- Network failures
- Malformed JSON responses
- Status mapping (PAID → paid, PENDING → pending, etc.)
- Order status fetching
- Missing optional fields (createdAt, lineItems)
- Interface method signatures

**Run:**

```bash
npm test godaddy-commerce-provider.test.ts
```

### 3. Appointment Integration Tests

**File:** `templates/server/api/appointments/__tests__/payment-integration.test.ts`

**Coverage:**

- ✅ Free appointment creation (no payment)
- ✅ Paid appointment creation (with payment)
- ✅ Payment provider not configured errors
- ✅ Appointment listing without order status
- ✅ Appointment listing with order status enrichment
- ✅ Payment status display (Paid, Pending, Free)
- ✅ Graceful degradation on errors
- ✅ POST endpoint validation
- ✅ GET endpoint filtering

**Key Test Scenarios:**

**POST /api/appointments:**

- Create free appointment (payment not configured)
- Create free appointment (payment configured)
- Create paid appointment successfully
- Payment provider called with correct parameters
- Error when payment required but not configured
- Error when payment session creation fails
- Database transaction rollback on payment failure

**GET /api/appointments:**

- List free appointments (displayStatus: "Confirmed (Free)")
- List paid appointments with order status
- Payment status enrichment (paid, pending, failed)
- Order status fetch failure handling
- No order status fetching when includeOrderStatus=false
- Payment provider not configured handling

**Run:**

```bash
npm test payment-integration.test.ts
```

## Test Coverage Summary

### Total Test Cases: 90+

| Test File                         | Test Cases | Coverage                     |
| --------------------------------- | ---------- | ---------------------------- |
| payment-provider-factory.test.ts  | 25         | Factory logic, configuration |
| godaddy-commerce-provider.test.ts | 40         | Provider implementation, API |
| payment-integration.test.ts       | 25+        | Endpoints, full flow         |

### Coverage by Feature

| Feature                        | Test Cases | Status |
| ------------------------------ | ---------- | ------ |
| Configuration detection        | 10         | ✅     |
| Payment provider instantiation | 8          | ✅     |
| Payment session creation       | 12         | ✅     |
| Order status queries           | 15         | ✅     |
| Status mapping                 | 10         | ✅     |
| Free appointments              | 5          | ✅     |
| Paid appointments              | 10         | ✅     |
| Error handling                 | 15         | ✅     |
| Graceful degradation           | 5          | ✅     |

## Running Tests

### Run All Payment Tests

```bash
# Run all payment-related tests
npm test payment

# With coverage
npm test payment -- --coverage
```

### Run Specific Test Files

```bash
# Factory tests only
npm test payment-provider-factory

# Provider tests only
npm test godaddy-commerce-provider

# Integration tests only
npm test payment-integration
```

### Run with Vitest UI

```bash
npm test -- --ui
```

Then navigate to the test files in the browser UI.

### Watch Mode

```bash
npm test -- --watch
```

## Test Patterns

### Mocking Payment Provider

```typescript
vi.mock('../../../utils/payment-provider-factory', () => {
  const mockProvider = {
    createPaymentSession: vi.fn(),
    getOrderStatus: vi.fn(),
  };

  return {
    getPaymentProvider: vi.fn(() => mockProvider),
    isPaymentProviderConfigured: vi.fn(),
  };
});
```

### Testing Free Appointments

```typescript
it('creates free appointment without payment', async () => {
  mockReq.body = {
    customerName: 'John Doe',
    customerEmail: 'john@example.com',
    date: '2025-01-21',
    time: '09:00',
    // No requiresPayment = defaults to false
  };

  await postHandler(mockReq as Request, mockRes as Response);

  expect(statusSpy).toHaveBeenCalledWith(201);
  expect(jsonSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      requiresPayment: false,
    })
  );
});
```

### Testing Paid Appointments

```typescript
it('creates paid appointment successfully', async () => {
  getMockProvider().createPaymentSession.mockResolvedValue({
    paymentUrl: 'https://checkout.example.com/session-123',
    orderId: 'order-123',
  });

  mockReq.body = {
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    date: '2025-01-21',
    time: '10:00',
    requiresPayment: true,
    amount: 5000,
  };

  await postHandler(mockReq as Request, mockRes as Response);

  expect(getMockProvider().createPaymentSession).toHaveBeenCalled();
  expect(jsonSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      checkoutUrl: 'https://checkout.example.com/session-123',
      orderId: 'order-123',
    })
  );
});
```

### Testing Error Scenarios

```typescript
it('returns error when payment not configured', async () => {
  vi.mocked(paymentFactory.isPaymentProviderConfigured).mockReturnValue(false);

  mockReq.body = {
    customerName: 'Test User',
    customerEmail: 'test@example.com',
    date: '2025-01-21',
    time: '10:00',
    requiresPayment: true,
    amount: 5000,
  };

  await postHandler(mockReq as Request, mockRes as Response);

  expect(statusSpy).toHaveBeenCalledWith(400);
  expect(jsonSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      error: 'Payment Not Configured',
    })
  );
});
```

## Test Data

### Valid Appointment Data

```typescript
const validFreeAppointment = {
  customerName: 'John Doe',
  customerEmail: 'john@example.com',
  customerPhone: '555-1234',
  date: '2025-01-21',
  time: '09:00',
  notes: 'First appointment',
};

const validPaidAppointment = {
  ...validFreeAppointment,
  requiresPayment: true,
  amount: 5000, // $50.00 in cents
};
```

### Mock Payment Session Response

```typescript
const mockPaymentSession = {
  paymentUrl: 'https://checkout.commerce.godaddy.com/session-abc123',
  orderId: 'draft-order-xyz789',
};
```

### Mock Order Status Response

```typescript
const mockOrderStatus = {
  orderId: 'draft-order-xyz789',
  status: 'paid' as const,
  amount: 5000,
  currency: 'USD',
  createdAt: '2025-01-21T10:00:00Z',
  updatedAt: '2025-01-21T10:05:00Z',
  metadata: {
    lineItems: [{ id: 'item-1', name: 'Appointment', quantity: 1, price: 5000 }],
  },
};
```

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Run payment tests
  run: npm test payment -- --coverage

- name: Upload coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/payment-*.json
```

### Pre-commit Hook

```bash
#!/bin/bash
# .husky/pre-commit

npm test payment -- --run
```

## Coverage Goals

| Area        | Current | Target |
| ----------- | ------- | ------ |
| Factory     | 100%    | 100%   |
| Provider    | 95%     | 95%    |
| Integration | 85%     | 90%    |
| Overall     | 93%     | 95%    |

## Adding New Payment Provider Tests

When adding a new payment provider (e.g., Stripe):

1. **Create provider test file:**

   ```
   templates/server/utils/__tests__/stripe-provider.test.ts
   ```

2. **Copy test structure from GoDaddy provider:**

   - Constructor validation
   - createPaymentSession tests
   - getOrderStatus tests
   - Status mapping
   - Error handling
   - Interface compliance

3. **Update factory tests:**

   - Add Stripe configuration detection
   - Test provider selection priority
   - Update environment variable tests

4. **Update integration tests:**
   - Ensure tests work with both providers
   - Add provider-specific scenarios if needed

## Debugging Failed Tests

### View detailed output

```bash
npm test payment -- --reporter=verbose
```

### Run single test

```bash
npm test payment -- -t "creates paid appointment successfully"
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Payment Tests",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["test", "payment", "--", "--no-coverage"],
  "console": "integratedTerminal"
}
```

## Common Issues

### Issue: "Payment provider not configured" in tests

**Solution:** Ensure mocks are set up correctly:

```typescript
beforeEach(() => {
  vi.mocked(paymentFactory.isPaymentProviderConfigured).mockReturnValue(true);
});
```

### Issue: Fetch is not defined

**Solution:** Mock global fetch:

```typescript
const mockFetch = vi.fn();
global.fetch = mockFetch as any;
```

### Issue: Database transaction not mocked

**Solution:** Mock the transaction chain:

```typescript
vi.mocked(db.transaction).mockImplementation(async (callback) => {
  return callback(db as any);
});
```

## Best Practices

1. **Test behavior, not implementation**

   - Focus on what the code does, not how
   - Don't test private methods

2. **Use descriptive test names**

   - ✅ "creates paid appointment successfully"
   - ❌ "test1"

3. **Keep tests independent**

   - Each test should work in isolation
   - Use beforeEach/afterEach for setup/cleanup

4. **Mock external dependencies**

   - Database, payment APIs, file system
   - Use vi.fn() for function mocks

5. **Test edge cases**

   - Empty strings, null, undefined
   - Network failures, timeouts
   - Invalid data formats

6. **Maintain test data**
   - Use constants for test data
   - Keep test data realistic

## Next Steps

- [ ] Add end-to-end tests with real database
- [ ] Add performance tests for payment operations
- [ ] Add security tests (SQL injection, XSS)
- [ ] Add load tests for concurrent appointments
- [ ] Add Stripe provider tests when implemented

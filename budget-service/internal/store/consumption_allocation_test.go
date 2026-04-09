package store

// Tests for credit allocation with expiration and renewability logic.
// Uses Go struct-based test fixtures for easy authoring and maintenance.

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// testBudgetItem represents a budget item for test fixtures.
type testBudgetItem struct {
	ID           string  `json:"id"`
	CreditsTotal string  `json:"creditsTotal"`
	CreditsUsed  string  `json:"creditsUsed"`
	CSR          string  `json:"creditSpendRatio"`
	ExpireAt     *string `json:"expireAt,omitempty"`
	ResetInt     *string `json:"resetInterval,omitempty"`
}

// testAllocation represents an expected allocation result.
type testAllocation struct {
	BudgetItemID string `json:"budgetItemId"`
	Credits      string `json:"credits"`
	UsdChunk     string `json:"usdChunk"`
}

// allocationTestCase defines a complete test scenario.
type allocationTestCase struct {
	Name                string           `json:"name"`
	Description         string           `json:"description"`
	Now                 string           `json:"now"`
	Items               []testBudgetItem `json:"items"`
	CostUSD             string           `json:"costUsd"`
	ExpectedAllocations []testAllocation `json:"expectedAllocations"`
	ExpectError         bool             `json:"expectError"`
	ExpectNoCapacity    bool             `json:"expectNoCapacity"`
	ExpectHasCapacity   bool             `json:"expectHasCapacity"`
}

// parseTestItems converts test fixtures to budgetConsumptionState slice.
func parseTestItems(items []testBudgetItem) ([]budgetConsumptionState, error) {
	out := make([]budgetConsumptionState, 0, len(items))
	for _, item := range items {
		total, err := decimal.NewFromString(item.CreditsTotal)
		if err != nil {
			return nil, err
		}
		used, err := decimal.NewFromString(item.CreditsUsed)
		if err != nil {
			return nil, err
		}
		csr, err := decimal.NewFromString(item.CSR)
		if err != nil {
			return nil, err
		}

		st := budgetConsumptionState{
			id:    item.ID,
			csr:   csr,
			total: total,
			used:  used,
		}

		if item.ExpireAt != nil {
			t, err := time.Parse(time.RFC3339, *item.ExpireAt)
			if err != nil {
				return nil, err
			}
			st.expireAt = &t
		}

		if item.ResetInt != nil {
			st.resetInt = item.ResetInt
		}

		out = append(out, st)
	}
	return out, nil
}

func strPtr(s string) *string {
	return &s
}

func runAllocationTest(t *testing.T, tc allocationTestCase) {
	t.Helper()

	now, err := time.Parse(time.RFC3339, tc.Now)
	if err != nil {
		t.Fatalf("invalid now time %q: %v", tc.Now, err)
	}

	items, err := parseTestItems(tc.Items)
	if err != nil {
		t.Fatalf("failed to parse test items: %v", err)
	}

	costUSD, err := decimal.NewFromString(tc.CostUSD)
	if err != nil {
		t.Fatalf("invalid costUsd %q: %v", tc.CostUSD, err)
	}

	// Test capacity check
	if tc.ExpectNoCapacity {
		hasCapacity := budgetHasConsumableCapacity(items, now)
		if hasCapacity {
			t.Error("expected no capacity, but budgetHasConsumableCapacity returned true")
		}
	}
	if tc.ExpectHasCapacity {
		hasCapacity := budgetHasConsumableCapacity(items, now)
		if !hasCapacity {
			t.Error("expected capacity, but budgetHasConsumableCapacity returned false")
		}
	}

	// Run allocation
	chunks, err := consumeBudgetCostUSD(costUSD, items, now)
	if tc.ExpectError {
		if err == nil {
			t.Errorf("expected error, got nil")
		}
		return
	}
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify allocations
	if len(chunks) != len(tc.ExpectedAllocations) {
		t.Fatalf("expected %d allocations, got %d", len(tc.ExpectedAllocations), len(chunks))
	}

	for i, expected := range tc.ExpectedAllocations {
		got := chunks[i]
		if got.budgetItemID != expected.BudgetItemID {
			t.Errorf("allocation[%d]: expected budgetItemId %q, got %q", i, expected.BudgetItemID, got.budgetItemID)
		}

		expectedCredits := decimal.RequireFromString(expected.Credits)
		if !got.credits.Equal(expectedCredits) {
			t.Errorf("allocation[%d]: expected credits %s, got %s", i, expected.Credits, got.credits.String())
		}

		expectedUsd := decimal.RequireFromString(expected.UsdChunk)
		if !got.usdChunk.Equal(expectedUsd) {
			t.Errorf("allocation[%d]: expected usdChunk %s, got %s", i, expected.UsdChunk, got.usdChunk.String())
		}
	}
}

// Test 1: A budget item that is renewable and has not expired should be allocated credits.
func TestRenewableNotExpiredAllocated(t *testing.T) {
	tc := allocationTestCase{
		Name:        "renewable_not_expired",
		Description: "A budget item that is renewable and has not expired should be allocated credits",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-renewable",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
				ResetInt:     strPtr("1mo"),
			},
		},
		CostUSD: "100",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-renewable", Credits: "100.000000", UsdChunk: "100"},
		},
		ExpectHasCapacity: true,
	}
	runAllocationTest(t, tc)
}

// Test 2: The budget item that expires first should be allocated credits first.
func TestExpiresFirstAllocatedFirst(t *testing.T) {
	tc := allocationTestCase{
		Name:        "expires_first_allocated_first",
		Description: "The budget item that expires first should be allocated credits first",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-later",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
			},
			{
				ID:           "item-sooner",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-07-01T23:59:59Z"),
			},
		},
		CostUSD: "50",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-sooner", Credits: "50.000000", UsdChunk: "50"},
		},
	}
	runAllocationTest(t, tc)
}

// Test 3: Renewable budget items should be allocated credits before non-renewable items,
// unless the non-renewable item expires before renewable date.
func TestRenewableBeforeNonRenewable(t *testing.T) {
	tc := allocationTestCase{
		Name:        "renewable_before_non_renewable",
		Description: "Renewable budget items should be allocated credits before non-renewable items",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-non-renewable",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
			},
			{
				ID:           "item-renewable",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
				ResetInt:     strPtr("1mo"),
			},
		},
		CostUSD: "50",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-renewable", Credits: "50.000000", UsdChunk: "50"},
		},
	}
	runAllocationTest(t, tc)
}

// Test 4: If a budget item has expired, it should not be allocated credits.
func TestExpiredNotAllocated(t *testing.T) {
	tc := allocationTestCase{
		Name:        "expired_not_allocated",
		Description: "If a budget item has expired, it should not be allocated credits",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-expired",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-05-31T23:59:59Z"), // expired
			},
			{
				ID:           "item-valid",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
			},
		},
		CostUSD: "50",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-valid", Credits: "50.000000", UsdChunk: "50"},
		},
	}
	runAllocationTest(t, tc)
}

// Test 5: Budget items that have used up all their credits should not be allocated more credits.
func TestExhaustedNotAllocated(t *testing.T) {
	tc := allocationTestCase{
		Name:        "exhausted_not_allocated",
		Description: "Budget items that have used up all their credits should not be allocated more credits",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-exhausted",
				CreditsTotal: "1000",
				CreditsUsed:  "1000", // fully used
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
				ResetInt:     strPtr("1mo"),
			},
			{
				ID:           "item-available",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
			},
		},
		CostUSD: "50",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-available", Credits: "50.000000", UsdChunk: "50"},
		},
	}
	runAllocationTest(t, tc)
}

// Test 6: A budget item that expires at the exact current time should not be allocated credits.
func TestExpiresAtExactTimeNotAllocated(t *testing.T) {
	tc := allocationTestCase{
		Name:        "expires_at_exact_time",
		Description: "A budget item that expires at the exact current time should not be allocated credits",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-expires-now",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-06-01T12:00:00Z"), // expires exactly at now
			},
			{
				ID:           "item-valid",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
			},
		},
		CostUSD: "50",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-valid", Credits: "50.000000", UsdChunk: "50"},
		},
	}
	runAllocationTest(t, tc)
}

// Test 7: A budget item that has a future expiration date but has already used all its credits
// should not be allocated more credits.
func TestFutureExpirationButExhausted(t *testing.T) {
	tc := allocationTestCase{
		Name:        "future_expiration_exhausted",
		Description: "A budget item with future expiration but all credits used should not be allocated",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-exhausted",
				CreditsTotal: "1000",
				CreditsUsed:  "1000", // all credits used
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"), // future date
			},
		},
		CostUSD:          "50",
		ExpectError:      true,
		ExpectNoCapacity: true,
	}
	runAllocationTest(t, tc)
}

// Test 8: A budget item that is renewable but has an expiration date in the past should not be allocated credits.
func TestRenewableButExpired(t *testing.T) {
	tc := allocationTestCase{
		Name:        "renewable_but_expired",
		Description: "A budget item that is renewable but has an expiration date in the past should not be allocated credits",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-renewable-expired",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-05-01T12:00:00Z"), // expired
				ResetInt:     strPtr("1mo"),
			},
			{
				ID:           "item-valid",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
			},
		},
		CostUSD: "50",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-valid", Credits: "50.000000", UsdChunk: "50"},
		},
	}
	runAllocationTest(t, tc)
}

// Additional test: No items available results in error.
func TestNoItemsAvailableError(t *testing.T) {
	tc := allocationTestCase{
		Name:        "no_items_available",
		Description: "When all items are expired or exhausted, allocation should fail",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-expired",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-01-01T12:00:00Z"),
			},
		},
		CostUSD:          "50",
		ExpectError:      true,
		ExpectNoCapacity: true,
	}
	runAllocationTest(t, tc)
}

// Additional test: Spill over to next item when first is exhausted during allocation.
func TestSpillOverOnExhaustion(t *testing.T) {
	tc := allocationTestCase{
		Name:        "spill_over_exhaustion",
		Description: "When first item runs out during allocation, spill to next available item",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-small",
				CreditsTotal: "50",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
				ResetInt:     strPtr("1mo"),
			},
			{
				ID:           "item-large",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
			},
		},
		CostUSD: "100",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-small", Credits: "50.000000", UsdChunk: "50"},
			{BudgetItemID: "item-large", Credits: "50.000000", UsdChunk: "50"},
		},
		ExpectHasCapacity: true,
	}
	runAllocationTest(t, tc)
}

// Additional test: Item with no expiration (null) should be consumable.
func TestNoExpirationIsConsumable(t *testing.T) {
	tc := allocationTestCase{
		Name:        "no_expiration_consumable",
		Description: "A budget item with no expiration date should be consumable",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-no-expiry",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     nil, // no expiration
			},
		},
		CostUSD: "50",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-no-expiry", Credits: "50.000000", UsdChunk: "50"},
		},
		ExpectHasCapacity: true,
	}
	runAllocationTest(t, tc)
}

// Additional test: Different credit spend ratios.
func TestDifferentCreditSpendRatios(t *testing.T) {
	tc := allocationTestCase{
		Name:        "different_csr",
		Description: "Items with different credit spend ratios allocate credits correctly",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-half-rate",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "0.5", // $0.50 per credit, so $50 = 100 credits
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
				ResetInt:     strPtr("1mo"),
			},
		},
		CostUSD: "50",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-half-rate", Credits: "100.000000", UsdChunk: "50"},
		},
	}
	runAllocationTest(t, tc)
}

// Additional test: Partial credits used.
func TestPartialCreditsUsed(t *testing.T) {
	tc := allocationTestCase{
		Name:        "partial_credits_used",
		Description: "Items with some credits already used should only allocate remaining",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-partial",
				CreditsTotal: "100",
				CreditsUsed:  "70", // 30 credits remaining
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
				ResetInt:     strPtr("1mo"),
			},
			{
				ID:           "item-full",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
			},
		},
		CostUSD: "50",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-partial", Credits: "30.000000", UsdChunk: "30"},
			{BudgetItemID: "item-full", Credits: "20.000000", UsdChunk: "20"},
		},
	}
	runAllocationTest(t, tc)
}

// Additional test: Renewable with earlier expiration comes before renewable with later expiration.
func TestRenewableSortedByExpiration(t *testing.T) {
	tc := allocationTestCase{
		Name:        "renewable_sorted_by_expiration",
		Description: "Among renewable items, earlier expiration should be consumed first",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-renewable-later",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
				ResetInt:     strPtr("1mo"),
			},
			{
				ID:           "item-renewable-sooner",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-07-31T23:59:59Z"),
				ResetInt:     strPtr("1mo"),
			},
		},
		CostUSD: "50",
		ExpectedAllocations: []testAllocation{
			{BudgetItemID: "item-renewable-sooner", Credits: "50.000000", UsdChunk: "50"},
		},
	}
	runAllocationTest(t, tc)
}

// Additional test: Zero cost USD allocation returns empty.
func TestZeroCostReturnsEmpty(t *testing.T) {
	tc := allocationTestCase{
		Name:        "zero_cost",
		Description: "Zero USD cost should return empty allocations with no error",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-valid",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
			},
		},
		CostUSD:             "0",
		ExpectedAllocations: []testAllocation{}, // empty
	}
	runAllocationTest(t, tc)
}

// Additional test: Capacity check with mixed expired and valid items.
func TestCapacityCheckMixedItems(t *testing.T) {
	now, _ := time.Parse(time.RFC3339, "2024-06-01T12:00:00Z")

	items := []budgetConsumptionState{
		{
			id:       "expired",
			csr:      decimal.RequireFromString("1"),
			total:    decimal.RequireFromString("1000"),
			used:     decimal.Zero,
			expireAt: func() *time.Time { tm, _ := time.Parse(time.RFC3339, "2024-01-01T00:00:00Z"); return &tm }(),
		},
		{
			id:       "exhausted",
			csr:      decimal.RequireFromString("1"),
			total:    decimal.RequireFromString("1000"),
			used:     decimal.RequireFromString("1000"),
			expireAt: func() *time.Time { tm, _ := time.Parse(time.RFC3339, "2024-12-31T00:00:00Z"); return &tm }(),
		},
	}

	if budgetHasConsumableCapacity(items, now) {
		t.Error("expected no capacity when all items are expired or exhausted")
	}

	// Add a valid item
	items = append(items, budgetConsumptionState{
		id:       "valid",
		csr:      decimal.RequireFromString("1"),
		total:    decimal.RequireFromString("1000"),
		used:     decimal.Zero,
		expireAt: func() *time.Time { tm, _ := time.Parse(time.RFC3339, "2024-12-31T00:00:00Z"); return &tm }(),
	})

	if !budgetHasConsumableCapacity(items, now) {
		t.Error("expected capacity when at least one valid item exists")
	}
}

// TestFilterConsumableItems directly tests the filtering function.
func TestFilterConsumableItems(t *testing.T) {
	now, _ := time.Parse(time.RFC3339, "2024-06-01T12:00:00Z")

	expired := func() *time.Time { tm, _ := time.Parse(time.RFC3339, "2024-01-01T00:00:00Z"); return &tm }()
	exactNow := func() *time.Time { tm, _ := time.Parse(time.RFC3339, "2024-06-01T12:00:00Z"); return &tm }()
	future := func() *time.Time { tm, _ := time.Parse(time.RFC3339, "2024-12-31T00:00:00Z"); return &tm }()
	monthlyReset := func() *string { s := "1mo"; return &s }()

	items := []budgetConsumptionState{
		{id: "expired", csr: decimal.RequireFromString("1"), total: decimal.RequireFromString("1000"), used: decimal.Zero, expireAt: expired},
		{id: "exact-now", csr: decimal.RequireFromString("1"), total: decimal.RequireFromString("1000"), used: decimal.Zero, expireAt: exactNow},
		{id: "exhausted", csr: decimal.RequireFromString("1"), total: decimal.RequireFromString("1000"), used: decimal.RequireFromString("1000"), expireAt: future},
		{id: "valid-renewable", csr: decimal.RequireFromString("1"), total: decimal.RequireFromString("1000"), used: decimal.Zero, expireAt: future, resetInt: monthlyReset},
		{id: "valid-no-expiry", csr: decimal.RequireFromString("1"), total: decimal.RequireFromString("1000"), used: decimal.Zero, expireAt: nil},
		{id: "valid-future", csr: decimal.RequireFromString("1"), total: decimal.RequireFromString("1000"), used: decimal.Zero, expireAt: future},
	}

	filtered := filterConsumableItems(items, now)

	if len(filtered) != 3 {
		t.Fatalf("expected 3 consumable items, got %d", len(filtered))
	}

	expectedIDs := map[string]bool{"valid-renewable": true, "valid-no-expiry": true, "valid-future": true}
	for _, item := range filtered {
		if !expectedIDs[item.id] {
			t.Errorf("unexpected item in filtered results: %s", item.id)
		}
	}
}

// TestInsufficientCreditsError verifies that an error is returned when there aren't enough credits.
func TestInsufficientCreditsError(t *testing.T) {
	tc := allocationTestCase{
		Name:        "insufficient_credits",
		Description: "Should return error when total available credits are insufficient",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "item-small",
				CreditsTotal: "50",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-12-31T23:59:59Z"),
			},
		},
		CostUSD:     "100", // need 100 credits, only 50 available
		ExpectError: true,
	}
	runAllocationTest(t, tc)
}

// TestAllExpiredItemsNoCapacity ensures no capacity when all items are expired.
func TestAllExpiredItemsNoCapacity(t *testing.T) {
	tc := allocationTestCase{
		Name:        "all_expired_no_capacity",
		Description: "No capacity when all items are expired",
		Now:         "2024-06-01T12:00:00Z",
		Items: []testBudgetItem{
			{
				ID:           "expired-renewable",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-01-01T12:00:00Z"),
				ResetInt:     strPtr("1mo"),
			},
			{
				ID:           "expired-plain",
				CreditsTotal: "1000",
				CreditsUsed:  "0",
				CSR:          "1",
				ExpireAt:     strPtr("2024-05-01T12:00:00Z"),
			},
		},
		CostUSD:          "50",
		ExpectError:      true,
		ExpectNoCapacity: true,
	}
	runAllocationTest(t, tc)
}

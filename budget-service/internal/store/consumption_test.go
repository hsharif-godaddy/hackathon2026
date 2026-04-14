package store

// Tests for consumeBudgetCostUSD: slice order is the contract (SQL ORDER BY must match before calling).

import (
	"errors"
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func TestConsumeBudgetCostUSDSortAndAllocation(t *testing.T) {
	rLow := decimal.RequireFromString("0.1")
	rHigh := decimal.RequireFromString("0.5")
	t1000 := decimal.RequireFromString("1000")
	z := decimal.Zero
	now := time.Now()
	earlier := now.Add(-time.Hour)
	later := now.Add(time.Hour)

	t.Run("allocatesInSortedOrder", func(t *testing.T) {
		// Items with createdAt controlling sort order (earlier first)
		items := []budgetConsumptionState{
			{id: "a", csr: rLow, total: t1000, used: z, createdAt: earlier},
			{id: "b", csr: rHigh, total: t1000, used: z, createdAt: later},
		}
		chunks, err := consumeBudgetCostUSD(decimal.RequireFromString("1"), items, now)
		if err != nil {
			t.Fatal(err)
		}
		if len(chunks) != 1 {
			t.Fatalf("chunks len %d want 1", len(chunks))
		}
		if chunks[0].budgetItemID != "a" {
			t.Fatalf("budgetItemID %q want a", chunks[0].budgetItemID)
		}
		want := decimal.RequireFromString("10.000000")
		if !chunks[0].credits.Equal(want) {
			t.Fatalf("credits %s want %s", chunks[0].credits.String(), want.String())
		}
	})

	t.Run("spillsToSecondWhenFirstCapacityUsdExhausted", func(t *testing.T) {
		// "small" created earlier, so it comes first in sort order
		items := []budgetConsumptionState{
			{id: "small", csr: decimal.RequireFromString("1"), total: decimal.RequireFromString("1"), used: z, createdAt: earlier},
			{id: "big", csr: decimal.RequireFromString("1"), total: t1000, used: z, createdAt: later},
		}
		chunks, err := consumeBudgetCostUSD(decimal.RequireFromString("3"), items, now)
		if err != nil {
			t.Fatal(err)
		}
		if len(chunks) != 2 {
			t.Fatalf("chunks len %d want 2", len(chunks))
		}
		if chunks[0].budgetItemID != "small" || chunks[1].budgetItemID != "big" {
			t.Fatalf("order got %s then %s", chunks[0].budgetItemID, chunks[1].budgetItemID)
		}
	})
}

func TestConsumeBudgetCostUSDSessionAllowsPartialWhenPoolExhausted(t *testing.T) {
	r1 := decimal.RequireFromString("1")
	t50 := decimal.RequireFromString("50")
	z := decimal.Zero
	now := time.Now()
	future := now.Add(time.Hour)
	items := []budgetConsumptionState{
		{id: "only", csr: r1, total: t50, used: z, expiresAt: &future, createdAt: now},
	}
	cost := decimal.RequireFromString("100")
	_, err := consumeBudgetCostUSD(cost, items, now)
	if err == nil {
		t.Fatal("strict mode: want ErrInsufficientCredits")
	}
	if err != ErrInsufficientCredits {
		t.Fatalf("strict: %v", err)
	}

	items2 := []budgetConsumptionState{
		{id: "only", csr: r1, total: t50, used: z, expiresAt: &future, createdAt: now},
	}
	chunks, err := consumeBudgetCostUSDSession(cost, items2, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 1 {
		t.Fatalf("chunks len %d want 1", len(chunks))
	}
	wantCredits := decimal.RequireFromString("50.000000")
	if !chunks[0].credits.Equal(wantCredits) {
		t.Fatalf("credits %s want %s", chunks[0].credits.String(), wantCredits.String())
	}
}

func TestConsumeBudgetCostUSDSessionEmptyPoolStoresZeroCredits(t *testing.T) {
	r1 := decimal.RequireFromString("1")
	t50 := decimal.RequireFromString("50")
	now := time.Now()
	future := now.Add(time.Hour)
	items := []budgetConsumptionState{
		{id: "exhausted", csr: r1, total: t50, used: t50, expiresAt: &future, createdAt: now},
	}
	cost := decimal.RequireFromString("5")
	chunks, err := consumeBudgetCostUSDSession(cost, items, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 0 {
		t.Fatalf("session mode: want no chunks when pool exhausted, got %d", len(chunks))
	}
	_, err = consumeBudgetCostUSD(cost, items, now)
	if !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("strict mode: want ErrInsufficientCredits, got %v", err)
	}
}

func TestBudgetHasConsumableCapacity(t *testing.T) {
	z := decimal.Zero
	t1000 := decimal.RequireFromString("1000")
	r1 := decimal.RequireFromString("1")
	now := time.Now()
	if !budgetHasConsumableCapacity([]budgetConsumptionState{{id: "a", csr: r1, total: t1000, used: z}}, now) {
		t.Fatal("expected true when pool has credits")
	}
	if budgetHasConsumableCapacity([]budgetConsumptionState{{id: "a", csr: r1, total: t1000, used: t1000}}, now) {
		t.Fatal("expected false when exhausted")
	}
	if budgetHasConsumableCapacity([]budgetConsumptionState{}, now) {
		t.Fatal("expected false for empty slice")
	}
}

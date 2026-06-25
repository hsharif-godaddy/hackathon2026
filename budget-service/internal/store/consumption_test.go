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

func TestConsumeCredits_SingleItem(t *testing.T) {
	t.Parallel()
	items := []budgetConsumptionState{{
		id: "item-1", total: decimal.NewFromInt(100), used: decimal.NewFromInt(20),
		csr: decimal.NewFromFloat(0.1), createdAt: time.Now(),
	}}
	chunks, err := consumeCredits(decimal.NewFromInt(50), items, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].budgetItemID != "item-1" {
		t.Fatalf("expected item-1, got %s", chunks[0].budgetItemID)
	}
	if !chunks[0].credits.Equal(decimal.NewFromInt(50)) {
		t.Fatalf("expected 50, got %s", chunks[0].credits)
	}
	if !items[0].used.Equal(decimal.NewFromInt(70)) {
		t.Fatalf("expected used=70, got %s", items[0].used)
	}
}

func TestConsumeCredits_MultiItem_WalkOrder(t *testing.T) {
	t.Parallel()
	now := time.Now()
	exp1 := now.Add(1 * time.Hour)
	exp2 := now.Add(2 * time.Hour)
	items := []budgetConsumptionState{
		{id: "no-reset", total: decimal.NewFromInt(100), used: decimal.Zero, csr: decimal.NewFromFloat(0.1), createdAt: now},
		{id: "resetting", total: decimal.NewFromInt(50), used: decimal.Zero, csr: decimal.NewFromFloat(0.1), resetInt: strPtr("MONTH"), createdAt: now},
		{id: "expires-soon", total: decimal.NewFromInt(30), used: decimal.Zero, csr: decimal.NewFromFloat(0.1), expiresAt: &exp1, createdAt: now},
		{id: "expires-later", total: decimal.NewFromInt(30), used: decimal.Zero, csr: decimal.NewFromFloat(0.1), expiresAt: &exp2, createdAt: now},
	}
	chunks, err := consumeCredits(decimal.NewFromInt(90), items, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 3 {
		t.Fatalf("expected 3 chunks, got %d", len(chunks))
	}
	if chunks[0].budgetItemID != "resetting" || !chunks[0].credits.Equal(decimal.NewFromInt(50)) {
		t.Fatalf("chunk[0] wrong: %+v", chunks[0])
	}
	if chunks[1].budgetItemID != "expires-soon" || !chunks[1].credits.Equal(decimal.NewFromInt(30)) {
		t.Fatalf("chunk[1] wrong: %+v", chunks[1])
	}
	if chunks[2].budgetItemID != "expires-later" || !chunks[2].credits.Equal(decimal.NewFromInt(10)) {
		t.Fatalf("chunk[2] wrong: %+v", chunks[2])
	}
}

func TestConsumeCredits_Insufficient(t *testing.T) {
	t.Parallel()
	items := []budgetConsumptionState{{
		id: "item-1", total: decimal.NewFromInt(30), used: decimal.NewFromInt(10),
		csr: decimal.NewFromFloat(0.1), createdAt: time.Now(),
	}}
	original := items[0].used
	_, err := consumeCredits(decimal.NewFromInt(50), items, time.Now())
	if !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("expected ErrInsufficientCredits, got %v", err)
	}
	if !items[0].used.Equal(original) {
		t.Fatalf("items mutated on failure: used=%s", items[0].used)
	}
}

func TestConsumeCredits_ExactFill(t *testing.T) {
	t.Parallel()
	items := []budgetConsumptionState{{
		id: "item-1", total: decimal.NewFromInt(50), used: decimal.NewFromInt(30),
		csr: decimal.NewFromFloat(0.1), createdAt: time.Now(),
	}}
	chunks, err := consumeCredits(decimal.NewFromInt(20), items, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !chunks[0].credits.Equal(decimal.NewFromInt(20)) {
		t.Fatalf("expected 20, got %s", chunks[0].credits)
	}
}

func TestConsumeCredits_SkipsExpired(t *testing.T) {
	t.Parallel()
	now := time.Now()
	expired := now.Add(-1 * time.Hour)
	items := []budgetConsumptionState{
		{id: "expired", total: decimal.NewFromInt(100), used: decimal.Zero, csr: decimal.NewFromFloat(0.1), expiresAt: &expired, createdAt: now},
		{id: "active", total: decimal.NewFromInt(50), used: decimal.Zero, csr: decimal.NewFromFloat(0.1), createdAt: now},
	}
	chunks, err := consumeCredits(decimal.NewFromInt(30), items, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 1 || chunks[0].budgetItemID != "active" {
		t.Fatalf("expected only active item, got %+v", chunks)
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

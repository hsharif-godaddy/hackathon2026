package store

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

func testOptimisticStore(t *testing.T) *Store {
	t.Helper()
	return testIntegrationStore(t)
}

// TestAppendSessionItemsBasicSuccess verifies the happy path works end-to-end.
func TestAppendSessionItemsBasicSuccess(t *testing.T) {
	st := testOptimisticStore(t)
	ctx := context.Background()

	key := "opt-basic-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}

	lines := []SessionLine{{Cost: "5.000000", CallRequestID: "cr-1"}}
	out, retBudgetID, err := st.AppendSessionItems(ctx, sessionID, lines)
	if err != nil {
		t.Fatalf("AppendSessionItems: %v", err)
	}
	if retBudgetID != budgetID {
		t.Fatalf("budgetID got %q want %q", retBudgetID, budgetID)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 result line, got %d", len(out))
	}
}

// TestAppendSessionItemsConcurrentAppendsSucceed races two appends on different sessions
// sharing a budget. Both should complete without error; this does not assert a retry
// (Phase 1→2 interleaving is not guaranteed in CI).
func TestAppendSessionItemsConcurrentAppendsSucceed(t *testing.T) {
	st := testOptimisticStore(t)
	ctx := context.Background()

	key := "opt-concurrent-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	// Create two sessions against the same budget.
	sess1 := uuid.NewString()
	sess2 := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sess1, nil); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateBudgetSession(ctx, budgetID, sess2, nil); err != nil {
		t.Fatal(err)
	}

	// Race two concurrent appends on different sessions (same budget items).
	var wg sync.WaitGroup
	var err1, err2 error
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _, err1 = st.AppendSessionItems(ctx, sess1, []SessionLine{
			{Cost: "1.000000", CallRequestID: "cr-race-1"},
		})
	}()
	go func() {
		defer wg.Done()
		_, _, err2 = st.AppendSessionItems(ctx, sess2, []SessionLine{
			{Cost: "1.000000", CallRequestID: "cr-race-2"},
		})
	}()
	wg.Wait()

	// Both should succeed (one may retry, but should not exhaust retries for a single conflict).
	if err1 != nil {
		t.Fatalf("session1 append failed: %v", err1)
	}
	if err2 != nil {
		t.Fatalf("session2 append failed: %v", err2)
	}
}

// TestAppendSessionItemsSpoilerContention hammers a shared budget item with a second session
// while the target session appends. The result may be success (target wins a try) or
// ErrOptimisticRetryExhausted; it is not a deterministic exhaustion test.
func TestAppendSessionItemsSpoilerContention(t *testing.T) {
	st := testOptimisticStore(t)
	ctx := context.Background()

	key := "opt-exhaust-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []ItemInput{
		{CreditsTotal: "1000.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}

	// A second session hammers the shared budget item to contend on credits_used with
	// the target session's append.
	spoilerSess := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, spoilerSess, nil); err != nil {
		t.Fatal(err)
	}

	stop := make(chan struct{})
	var spoilerWg sync.WaitGroup
	spoilerWg.Add(1)
	go func() {
		defer spoilerWg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				// Each append changes credits_used on the shared budget_items row.
				_, _, _ = st.AppendSessionItems(ctx, spoilerSess, []SessionLine{
					{Cost: "0.000001", CallRequestID: "spoiler-" + uuid.NewString()},
				})
			}
		}
	}()

	_, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "1.000000", CallRequestID: "cr-exhaust-1"},
	})
	close(stop)
	spoilerWg.Wait()

	// Under heavy concurrent modification, the append should either succeed
	// (if it wins a retry) or fail with ErrOptimisticRetryExhausted.
	if err != nil && !errors.Is(err, ErrOptimisticRetryExhausted) {
		t.Fatalf("expected nil or ErrOptimisticRetryExhausted, got: %v", err)
	}
}

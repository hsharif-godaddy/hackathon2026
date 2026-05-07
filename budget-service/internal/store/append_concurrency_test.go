package store

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

// TestAppendSessionItemsBasicSuccess verifies the happy path works end-to-end.
func TestAppendSessionItemsBasicSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	key := "append-basic-" + uuid.NewString()
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

// TestAppendSessionItemsConcurrentSessionsSerialize races two appends on different sessions
// sharing a budget. Both must complete without error — the per-budget advisory lock
// serializes them, so neither sees a stale view of the other.
func TestAppendSessionItemsConcurrentSessionsSerialize(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	key := "append-concurrent-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	sess1 := uuid.NewString()
	sess2 := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sess1, nil); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateBudgetSession(ctx, budgetID, sess2, nil); err != nil {
		t.Fatal(err)
	}

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

	if err1 != nil {
		t.Fatalf("session1 append failed: %v", err1)
	}
	if err2 != nil {
		t.Fatalf("session2 append failed: %v", err2)
	}

	// Arithmetic readback: the replay loop in AppendSessionItems must stack each
	// session's new line on a pool that already reflects the other session's prior
	// line. Each session appended $1 at CSR 1.0, so each should have credits_charged
	// = 1.0, and the budget's pending pool should reflect $2 consumed total.
	s1, err := st.GetBudgetSession(ctx, sess1)
	if err != nil {
		t.Fatalf("GetBudgetSession sess1: %v", err)
	}
	if s1.CreditsChargedTotal != "1.000000" {
		t.Fatalf("sess1 credits_charged: got %q want %q", s1.CreditsChargedTotal, "1.000000")
	}
	s2, err := st.GetBudgetSession(ctx, sess2)
	if err != nil {
		t.Fatalf("GetBudgetSession sess2: %v", err)
	}
	if s2.CreditsChargedTotal != "1.000000" {
		t.Fatalf("sess2 credits_charged: got %q want %q", s2.CreditsChargedTotal, "1.000000")
	}
}

// TestAppendSessionItemsSpoilerContentionSucceeds hammers a shared budget item with a second
// session while the target session appends. Under the advisory-lock design, all appends on
// the same budget serialize cleanly — no retries, no exhaustion.
func TestAppendSessionItemsSpoilerContentionSucceeds(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	key := "append-spoiler-" + uuid.NewString()
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
				_, _, _ = st.AppendSessionItems(ctx, spoilerSess, []SessionLine{
					{Cost: "0.000001", CallRequestID: "spoiler-" + uuid.NewString()},
				})
			}
		}
	}()

	_, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "1.000000", CallRequestID: "cr-target-1"},
	})
	close(stop)
	spoilerWg.Wait()

	if err != nil {
		t.Fatalf("target append should not fail under advisory-lock serialization: %v", err)
	}
}

// TestAppendRacesReconciliation asserts that the pre-lock resolveOpenSessionTx
// rejects an already-reconciled session with ErrAlreadyReconciled. The post-lock
// resolve exists for the race where reconciliation commits between the pre-lock
// resolve and lockBudgetTx; that interleaving is not deterministically reproducible
// in a Go test, so the symmetric post-lock check is verified only by code review.
func TestAppendRacesReconciliation(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	key := "append-post-reconcile-" + uuid.NewString()
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
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "1.000000", CallRequestID: "pre-reconcile"},
	}); err != nil {
		t.Fatalf("pre-reconcile append: %v", err)
	}
	if _, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "1.000000", ProductCost: "1.000000", Label: "t"},
	}, false); err != nil {
		t.Fatalf("CreateSessionReport: %v", err)
	}

	_, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "1.000000", CallRequestID: "post-reconcile"},
	})
	if !errors.Is(err, ErrAlreadyReconciled) {
		t.Fatalf("expected ErrAlreadyReconciled, got: %v", err)
	}
}

// TestCreateSessionReportConcurrentExactlyOneWins races two CreateSessionReport calls on
// the same session and asserts exactly one succeeds; the other returns ErrAlreadyReconciled.
// Under the advisory lock, either the post-lock resolveOpenSessionTx or the unique constraint
// on budget_session_reports.session_id could be the mechanism that rejects the loser — this
// test verifies the outcome invariant, not which specific guard fired.
func TestCreateSessionReportConcurrentExactlyOneWins(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	key := "reconcile-race-" + uuid.NewString()
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
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "1.000000", CallRequestID: "pre-reconcile"},
	}); err != nil {
		t.Fatalf("pre-reconcile append: %v", err)
	}

	var wg sync.WaitGroup
	var err1, err2 error
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _, err1 = st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
			{BudgetCost: "1.000000", ProductCost: "1.000000", Label: "a"},
		}, false)
	}()
	go func() {
		defer wg.Done()
		_, _, err2 = st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
			{BudgetCost: "1.000000", ProductCost: "1.000000", Label: "b"},
		}, false)
	}()
	wg.Wait()

	ok1 := err1 == nil
	ok2 := err2 == nil
	if ok1 == ok2 {
		t.Fatalf("expected exactly one winner; got err1=%v err2=%v", err1, err2)
	}
	loser := err1
	if ok1 {
		loser = err2
	}
	if !errors.Is(loser, ErrAlreadyReconciled) {
		t.Fatalf("loser should be ErrAlreadyReconciled, got: %v", loser)
	}
}

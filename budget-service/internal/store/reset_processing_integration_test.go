package store

import (
	"context"
	"database/sql"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/shopspring/decimal"

	schemamigrate "github.com/gdcorp-partners/airo-app-builder/budget-service/internal/migrate"
)

var resetIntegrationMigrateOnce sync.Once

func testIntegrationStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set (integration)")
	}
	var migrateErr error
	resetIntegrationMigrateOnce.Do(func() {
		migrateErr = schemamigrate.Up(dsn)
	})
	if migrateErr != nil {
		t.Fatalf("migrate: %v", migrateErr)
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(db)
}

func periodicResetCount(t *testing.T, st *Store, itemID string) int {
	t.Helper()
	var count int
	if err := st.db.QueryRow(`
		SELECT COUNT(*)
		FROM budget_item_credit_ledger
		WHERE budget_item_id = $1 AND entry_kind = 'periodic_reset'
	`, itemID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func itemResetState(t *testing.T, st *Store, itemID string) (decimal.Decimal, time.Time) {
	t.Helper()
	var used decimal.Decimal
	var resetsAt time.Time
	if err := st.db.QueryRow(`
		SELECT credits_used, resets_at
		FROM budget_items
		WHERE id = $1
	`, itemID).Scan(&used, &resetsAt); err != nil {
		t.Fatal(err)
	}
	return used, resetsAt
}

func TestCreateBudgetSessionAppliesDueResetAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "reset-lazy-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-48 * time.Hour).Format(time.RFC3339)
	resetsAt := now.Add(-1 * time.Hour).Format(time.RFC3339)
	interval := "1d"

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
		CreditsTotal:     "10.000000",
		CreditSpendRatio: "1.000000",
		StartsAt:         &startsAt,
		ResetsAt:         &resetsAt,
		ResetInterval:    &interval,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID)
	if err != nil {
		t.Fatal(err)
	}
	if len(budget.Items) != 1 {
		t.Fatalf("items len = %d want 1", len(budget.Items))
	}
	itemID := budget.Items[0].ID

	if _, err := st.db.ExecContext(ctx, `
		INSERT INTO budget_item_credit_ledger (id, budget_item_id, entry_kind, credits_delta)
		VALUES ($1, $2, 'session_spend', $3)
	`, uuid.NewString(), itemID, "10.000000"); err != nil {
		t.Fatal(err)
	}

	usedBefore, oldResetsAt := itemResetState(t, st, itemID)
	if !usedBefore.Equal(decimal.RequireFromString("10")) {
		t.Fatalf("credits_used before reset = %s want 10", usedBefore.StringFixed(6))
	}
	if !oldResetsAt.Before(time.Now().UTC()) {
		t.Fatalf("resets_at should be due, got %s", oldResetsAt.Format(time.RFC3339Nano))
	}

	if err := st.CreateBudgetSession(ctx, budgetID, uuid.NewString(), nil); err != nil {
		t.Fatal(err)
	}

	usedAfter, newResetsAt := itemResetState(t, st, itemID)
	if !usedAfter.Equal(decimal.Zero) {
		t.Fatalf("credits_used after reset = %s want 0", usedAfter.StringFixed(6))
	}
	if !newResetsAt.After(time.Now().UTC()) {
		t.Fatalf("resets_at after reset should be in future, got %s", newResetsAt.Format(time.RFC3339Nano))
	}
	if got := periodicResetCount(t, st, itemID); got != 1 {
		t.Fatalf("periodic_reset rows = %d want 1", got)
	}

	if err := st.CreateBudgetSession(ctx, budgetID, uuid.NewString(), nil); err != nil {
		t.Fatal(err)
	}
	if got := periodicResetCount(t, st, itemID); got != 1 {
		t.Fatalf("periodic_reset rows after second lazy apply = %d want 1", got)
	}
}

func TestProcessDueBudgetItemResetsAdvancesScheduleWithoutLedgerWhenUnused(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "reset-unused-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)
	resetsAt := now.Add(-2 * time.Hour).Format(time.RFC3339)
	interval := "1d"

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
		CreditsTotal:     "5.000000",
		CreditSpendRatio: "1.000000",
		StartsAt:         &startsAt,
		ResetsAt:         &resetsAt,
		ResetInterval:    &interval,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID)
	if err != nil {
		t.Fatal(err)
	}
	itemID := budget.Items[0].ID

	if _, err := st.db.ExecContext(ctx, `SELECT public.process_due_budget_item_resets($1::uuid, $2::integer)`, budgetID, 500); err != nil {
		t.Fatal(err)
	}

	usedAfter, newResetsAt := itemResetState(t, st, itemID)
	if !usedAfter.Equal(decimal.Zero) {
		t.Fatalf("credits_used after reset processor = %s want 0", usedAfter.StringFixed(6))
	}
	if !newResetsAt.After(time.Now().UTC()) {
		t.Fatalf("resets_at after reset processor should be in future, got %s", newResetsAt.Format(time.RFC3339Nano))
	}
	if got := periodicResetCount(t, st, itemID); got != 0 {
		t.Fatalf("periodic_reset rows = %d want 0", got)
	}
}

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

func itemResetState(t *testing.T, st *Store, itemID string) (decimal.Decimal, sql.NullTime) {
	t.Helper()
	var used decimal.Decimal
	var resetsAt sql.NullTime
	if err := st.db.QueryRow(`
		SELECT credits_used, resets_at
		FROM budget_items
		WHERE id = $1
	`, itemID).Scan(&used, &resetsAt); err != nil {
		t.Fatal(err)
	}
	return used, resetsAt
}

func outboxEventCount(t *testing.T, st *Store, eventType, idempotencyKeyPrefix string) int {
	t.Helper()
	var count int
	if err := st.db.QueryRow(`
		SELECT COUNT(*)
		FROM webhook_outbox
		WHERE event_type = $1 AND idempotency_key LIKE $2
	`, eventType, idempotencyKeyPrefix+"%").Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func expirationNotifiedAt(t *testing.T, st *Store, itemID string) sql.NullTime {
	t.Helper()
	var notifiedAt sql.NullTime
	if err := st.db.QueryRow(`
		SELECT expiration_notified_at
		FROM budget_items
		WHERE id = $1
	`, itemID).Scan(&notifiedAt); err != nil {
		t.Fatal(err)
	}
	return notifiedAt
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
		CreditsTotal:    "10.000000",
		CostCreditRatio: "1.000000",
		StartsAt:        &startsAt,
		ResetsAt:        &resetsAt,
		ResetInterval:   &interval,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
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
	if !oldResetsAt.Valid {
		t.Fatalf("resets_at should be set, got null")
	}
	if !oldResetsAt.Time.Before(time.Now().UTC()) {
		t.Fatalf("resets_at should be due, got %s", oldResetsAt.Time.Format(time.RFC3339Nano))
	}

	if err := st.CreateBudgetSession(ctx, budgetID, uuid.NewString(), nil, false); err != nil {
		t.Fatal(err)
	}

	usedAfter, newResetsAt := itemResetState(t, st, itemID)
	if !usedAfter.Equal(decimal.Zero) {
		t.Fatalf("credits_used after reset = %s want 0", usedAfter.StringFixed(6))
	}
	if !newResetsAt.Valid {
		t.Fatalf("resets_at after reset should be set, got null")
	}
	if !newResetsAt.Time.After(time.Now().UTC()) {
		t.Fatalf("resets_at after reset should be in future, got %s", newResetsAt.Time.Format(time.RFC3339Nano))
	}
	if got := periodicResetCount(t, st, itemID); got != 1 {
		t.Fatalf("periodic_reset rows = %d want 1", got)
	}

	if err := st.CreateBudgetSession(ctx, budgetID, uuid.NewString(), nil, false); err != nil {
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
		CreditsTotal:    "5.000000",
		CostCreditRatio: "1.000000",
		StartsAt:        &startsAt,
		ResetsAt:        &resetsAt,
		ResetInterval:   &interval,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
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
	if !newResetsAt.Valid {
		t.Fatalf("resets_at after reset processor should be set, got null")
	}
	if !newResetsAt.Time.After(time.Now().UTC()) {
		t.Fatalf("resets_at after reset processor should be in future, got %s", newResetsAt.Time.Format(time.RFC3339Nano))
	}
	if got := periodicResetCount(t, st, itemID); got != 0 {
		t.Fatalf("periodic_reset rows = %d want 0", got)
	}
}

func TestProcessDueResetsWithOutboxCreatesLedgerAndOutboxForUsedCredits(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "reset-outbox-used-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-48 * time.Hour).Format(time.RFC3339)
	resetsAt := now.Add(-1 * time.Hour).Format(time.RFC3339)
	interval := "1d"

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
		CreditsTotal:    "10.000000",
		CostCreditRatio: "1.000000",
		StartsAt:        &startsAt,
		ResetsAt:        &resetsAt,
		ResetInterval:   &interval,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	itemID := budget.Items[0].ID

	// Simulate credits used
	if _, err := st.db.ExecContext(ctx, `
		INSERT INTO budget_item_credit_ledger (id, budget_item_id, entry_kind, credits_delta)
		VALUES ($1, $2, 'session_spend', $3)
	`, uuid.NewString(), itemID, "7.500000"); err != nil {
		t.Fatal(err)
	}

	usedBefore, _ := itemResetState(t, st, itemID)
	if !usedBefore.Equal(decimal.RequireFromString("7.5")) {
		t.Fatalf("credits_used before = %s want 7.5", usedBefore.StringFixed(6))
	}

	count, err := st.ProcessDueResetsWithOutbox(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}

	if count == 0 {
		t.Fatal("expected at least 1 item processed")
	}

	// Verify ledger entry was created
	if got := periodicResetCount(t, st, itemID); got != 1 {
		t.Fatalf("periodic_reset rows = %d want 1", got)
	}

	// Verify credits_used is now 0
	usedAfter, newResetsAt := itemResetState(t, st, itemID)
	if !usedAfter.Equal(decimal.Zero) {
		t.Fatalf("credits_used after = %s want 0", usedAfter.StringFixed(6))
	}
	if !newResetsAt.Valid {
		t.Fatalf("resets_at should be set, got null")
	}
	if !newResetsAt.Time.After(now) {
		t.Fatalf("resets_at should be in future, got %s", newResetsAt.Time.Format(time.RFC3339Nano))
	}

	// Verify outbox event was created
	if got := outboxEventCount(t, st, "budget-item.reset", "budget-item.reset:"+itemID); got != 1 {
		t.Fatalf("outbox events = %d want 1", got)
	}
}

func TestProcessDueResetsWithOutboxNoLedgerOrOutboxWhenUnused(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "reset-outbox-unused-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)
	resetsAt := now.Add(-2 * time.Hour).Format(time.RFC3339)
	interval := "1d"

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
		CreditsTotal:    "5.000000",
		CostCreditRatio: "1.000000",
		StartsAt:        &startsAt,
		ResetsAt:        &resetsAt,
		ResetInterval:   &interval,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	itemID := budget.Items[0].ID

	count, err := st.ProcessDueResetsWithOutbox(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}

	if count == 0 {
		t.Fatal("expected at least 1 item processed")
	}

	// No ledger entry when nothing was used
	if got := periodicResetCount(t, st, itemID); got != 0 {
		t.Fatalf("periodic_reset rows = %d want 0", got)
	}

	// No outbox event when nothing was used (webhook only fires for positive credits)
	if got := outboxEventCount(t, st, "budget-item.reset", "budget-item.reset:"+itemID); got != 0 {
		t.Fatalf("outbox events = %d want 0 (no credits were reset)", got)
	}

	// resets_at should still be advanced
	_, newResetsAt := itemResetState(t, st, itemID)
	if !newResetsAt.Valid {
		t.Fatalf("resets_at should be set, got null")
	}
	if !newResetsAt.Time.After(now) {
		t.Fatalf("resets_at should be in future, got %s", newResetsAt.Time.Format(time.RFC3339Nano))
	}
}

func TestProcessDueResetsWithOutboxRespectsBatchSize(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "reset-batch-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-48 * time.Hour).Format(time.RFC3339)
	resetsAt := now.Add(-1 * time.Hour).Format(time.RFC3339)
	interval := "1d"

	// Create 3 budget items that are due for reset
	for i := 0; i < 3; i++ {
		budgetID := uuid.NewString()
		if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
			CreditsTotal:    "10.000000",
			CostCreditRatio: "1.000000",
			StartsAt:        &startsAt,
			ResetsAt:        &resetsAt,
			ResetInterval:   &interval,
		}}); err != nil {
			t.Fatal(err)
		}
	}

	// Process with batch size of 2
	count, err := st.ProcessDueResetsWithOutbox(ctx, 2)
	if err != nil {
		t.Fatal(err)
	}

	if count != 2 {
		t.Fatalf("batch size not respected: got %d results, want 2", count)
	}
}

func TestProcessDueExpirationsWithOutboxMarksNotified(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "expire-outbox-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-48 * time.Hour).Format(time.RFC3339)
	// Expired 30 seconds ago
	expiresAt := now.Add(-30 * time.Second).Format(time.RFC3339)

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
		CreditsTotal:    "100.000000",
		CostCreditRatio: "1.000000",
		StartsAt:        &startsAt,
		ExpiresAt:       &expiresAt,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	itemID := budget.Items[0].ID

	// Add some usage
	if _, err := st.db.ExecContext(ctx, `
		INSERT INTO budget_item_credit_ledger (id, budget_item_id, entry_kind, credits_delta)
		VALUES ($1, $2, 'session_spend', $3)
	`, uuid.NewString(), itemID, "25.000000"); err != nil {
		t.Fatal(err)
	}

	// Verify not notified yet
	notified := expirationNotifiedAt(t, st, itemID)
	if notified.Valid {
		t.Fatal("expected expiration_notified_at to be null before processing")
	}

	count, err := st.ProcessDueExpirationsWithOutbox(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}

	if count == 0 {
		t.Fatal("expected at least 1 expiration processed")
	}

	// Verify now notified
	notified = expirationNotifiedAt(t, st, itemID)
	if !notified.Valid {
		t.Fatal("expected expiration_notified_at to be set after processing")
	}

	// Verify outbox event was created
	if got := outboxEventCount(t, st, "budget-item.expired", "budget-item.expired:"+itemID); got != 1 {
		t.Fatalf("outbox events = %d want 1", got)
	}
}

func TestProcessDueExpirationsWithOutboxIdempotent(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "expire-idempotent-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-48 * time.Hour).Format(time.RFC3339)
	expiresAt := now.Add(-30 * time.Second).Format(time.RFC3339)

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
		CreditsTotal:    "50.000000",
		CostCreditRatio: "1.000000",
		StartsAt:        &startsAt,
		ExpiresAt:       &expiresAt,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	itemID := budget.Items[0].ID

	// First call should process
	count1, err := st.ProcessDueExpirationsWithOutbox(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}
	if count1 == 0 {
		t.Fatal("expected at least 1 expiration processed on first call")
	}

	// Second call should not process (already notified)
	count2, err := st.ProcessDueExpirationsWithOutbox(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}

	// Count of items with this specific itemID in results should be 0
	// (the item was already notified)
	// Verify only 1 outbox event exists (idempotent)
	if got := outboxEventCount(t, st, "budget-item.expired", "budget-item.expired:"+itemID); got != 1 {
		t.Fatalf("outbox events = %d want 1 (should be idempotent)", got)
	}

	// count2 might include other items from other tests, so we just check the outbox
	_ = count2
}

func TestProcessDueExpirationsWithOutboxExcludesDeleted(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "expire-deleted-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-48 * time.Hour).Format(time.RFC3339)
	expiresAt := now.Add(-30 * time.Second).Format(time.RFC3339)

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
		CreditsTotal:    "50.000000",
		CostCreditRatio: "1.000000",
		StartsAt:        &startsAt,
		ExpiresAt:       &expiresAt,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	itemID := budget.Items[0].ID

	// Soft delete the item
	if _, err := st.db.ExecContext(ctx, `UPDATE budget_items SET deleted_at = now() WHERE id = $1`, itemID); err != nil {
		t.Fatal(err)
	}

	_, err = st.ProcessDueExpirationsWithOutbox(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}

	// No outbox event for deleted item
	if got := outboxEventCount(t, st, "budget-item.expired", "budget-item.expired:"+itemID); got != 0 {
		t.Fatalf("outbox events = %d want 0 (deleted item should be excluded)", got)
	}
}

func TestOutboxDrainAndMarkCompleted(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "outbox-drain-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	// Insert a test outbox event directly with an early next_attempt_at so it
	// sorts first regardless of leftover rows from other tests.
	eventID := uuid.NewString()
	idempotencyKey := "test:" + uuid.NewString()
	if _, err := st.db.ExecContext(ctx, `
		INSERT INTO webhook_outbox (id, event_type, product_key, payload, idempotency_key, next_attempt_at)
		VALUES ($1, 'test.event', $2, '{"test": true}'::jsonb, $3, '2000-01-01T00:00:00Z')
	`, eventID, productKey, idempotencyKey); err != nil {
		t.Fatal(err)
	}

	// Drain should find the event
	events, err := st.DrainWebhookOutbox(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}

	var found *OutboxEvent
	for i := range events {
		if events[i].ID == eventID {
			found = &events[i]
			break
		}
	}
	if found == nil {
		t.Fatal("expected to find event in drain results")
	}

	if found.EventType != "test.event" {
		t.Fatalf("EventType = %s want test.event", found.EventType)
	}
	if found.ProductKey != productKey {
		t.Fatalf("ProductKey = %s want %s", found.ProductKey, productKey)
	}

	// Mark completed
	if err := st.MarkOutboxEventCompleted(ctx, eventID); err != nil {
		t.Fatal(err)
	}

	// Verify status
	var status string
	if err := st.db.QueryRow(`SELECT status FROM webhook_outbox WHERE id = $1`, eventID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "completed" {
		t.Fatalf("status = %s want completed", status)
	}
}

func TestOutboxMarkFailedWithBackoff(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "outbox-fail-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	// Insert a test outbox event with attempt_count = 2
	eventID := uuid.NewString()
	idempotencyKey := "test:" + uuid.NewString()
	if _, err := st.db.ExecContext(ctx, `
		INSERT INTO webhook_outbox (id, event_type, product_key, payload, idempotency_key, attempt_count)
		VALUES ($1, 'test.event', $2, '{"test": true}'::jsonb, $3, 2)
	`, eventID, productKey, idempotencyKey); err != nil {
		t.Fatal(err)
	}

	// Mark failed with max attempts = 7
	if err := st.MarkOutboxEventFailed(ctx, eventID, "connection refused", 7); err != nil {
		t.Fatal(err)
	}

	// Verify status is pending (still has retries left)
	var status string
	var nextAttemptAt time.Time
	var lastError sql.NullString
	if err := st.db.QueryRow(`SELECT status, next_attempt_at, last_error FROM webhook_outbox WHERE id = $1`, eventID).Scan(&status, &nextAttemptAt, &lastError); err != nil {
		t.Fatal(err)
	}
	if status != "pending" {
		t.Fatalf("status = %s want pending (attempt 2 < max 7)", status)
	}
	if !lastError.Valid || lastError.String != "connection refused" {
		t.Fatalf("last_error = %v want 'connection refused'", lastError)
	}
	// next_attempt_at should be in the future (backoff)
	if !nextAttemptAt.After(time.Now()) {
		t.Fatalf("next_attempt_at should be in future, got %s", nextAttemptAt.Format(time.RFC3339Nano))
	}
}

func TestOutboxMarkFailedFinal(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "outbox-fail-final-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	// Insert a test outbox event with attempt_count = 7 (max)
	eventID := uuid.NewString()
	idempotencyKey := "test:" + uuid.NewString()
	if _, err := st.db.ExecContext(ctx, `
		INSERT INTO webhook_outbox (id, event_type, product_key, payload, idempotency_key, attempt_count)
		VALUES ($1, 'test.event', $2, '{"test": true}'::jsonb, $3, 7)
	`, eventID, productKey, idempotencyKey); err != nil {
		t.Fatal(err)
	}

	// Mark failed with max attempts = 7
	if err := st.MarkOutboxEventFailed(ctx, eventID, "final failure", 7); err != nil {
		t.Fatal(err)
	}

	// Verify status is failed
	var status string
	if err := st.db.QueryRow(`SELECT status FROM webhook_outbox WHERE id = $1`, eventID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "failed" {
		t.Fatalf("status = %s want failed (attempt 7 >= max 7)", status)
	}
}

func TestOutboxCleanup(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "outbox-cleanup-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	// Insert a completed event with processed_at in the past
	eventID := uuid.NewString()
	idempotencyKey := "test:" + uuid.NewString()
	if _, err := st.db.ExecContext(ctx, `
		INSERT INTO webhook_outbox (id, event_type, product_key, payload, idempotency_key, status, processed_at)
		VALUES ($1, 'test.event', $2, '{"test": true}'::jsonb, $3, 'completed', now() - interval '10 days')
	`, eventID, productKey, idempotencyKey); err != nil {
		t.Fatal(err)
	}

	// Cleanup with 7 day retention
	deleted, err := st.CleanupCompletedOutboxEvents(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}

	if deleted == 0 {
		t.Fatal("expected at least 1 event to be deleted")
	}

	// Verify event is gone
	var count int
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM webhook_outbox WHERE id = $1`, eventID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("event should be deleted, got count = %d", count)
	}
}

func TestCreateSessionReportTriggersExhaustedWebhook(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "exhausted-test-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)

	// Create budget with small credit pool (10 credits at 1:1 ratio = $10 capacity)
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
		CreditsTotal:    "10.000000",
		CostCreditRatio: "1.000000",
		StartsAt:        &startsAt,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	itemID := budget.Items[0].ID

	// Create session
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}

	// Create report that exactly exhausts the budget (10 credits = $10)
	reportID, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "10.000000", ProductCost: "10.000000", Label: "exhaust"},
	}, false)
	if err != nil {
		t.Fatal(err)
	}

	// Verify outbox event was created for exhausted item
	if got := outboxEventCount(t, st, "budget-item.exhausted", "budget-item.exhausted:"+itemID); got != 1 {
		t.Fatalf("exhausted outbox events = %d want 1", got)
	}

	// Verify report.created event was also created
	if got := outboxEventCount(t, st, "report.created", "report.created:"+reportID); got != 1 {
		t.Fatalf("report.created outbox events = %d want 1", got)
	}
}

func TestCreateSessionReportNoExhaustedWebhookWhenNotFullyConsumed(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "partial-spend-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)

	// Create budget with 100 credits
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
		CreditsTotal:    "100.000000",
		CostCreditRatio: "1.000000",
		StartsAt:        &startsAt,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	itemID := budget.Items[0].ID

	// Create session
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}

	// Create report that only uses 50 credits (not exhausted)
	_, _, err = st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "50.000000", ProductCost: "50.000000", Label: "partial"},
	}, false)
	if err != nil {
		t.Fatal(err)
	}

	// Verify NO exhausted outbox event was created
	if got := outboxEventCount(t, st, "budget-item.exhausted", "budget-item.exhausted:"+itemID); got != 0 {
		t.Fatalf("exhausted outbox events = %d want 0 (item not exhausted)", got)
	}
}

func TestCreateSessionReportNoExhaustedWebhookWhenAlreadyExhausted(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "already-exhausted-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)

	// Create budget with 10 credits
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{{
		CreditsTotal:    "10.000000",
		CostCreditRatio: "1.000000",
		StartsAt:        &startsAt,
	}}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	itemID := budget.Items[0].ID

	// Open session while the pool still has capacity (CreateBudgetSession rejects 402 when nothing is left).
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}

	// Pre-exhaust the item via direct ledger entry; report will still see the item as already exhausted.
	if _, err := st.db.ExecContext(ctx, `
		INSERT INTO budget_item_credit_ledger (id, budget_item_id, entry_kind, credits_delta)
		VALUES ($1, $2, 'session_spend', $3)
	`, uuid.NewString(), itemID, "10.000000"); err != nil {
		t.Fatal(err)
	}

	// Verify item is exhausted
	used, _ := itemResetState(t, st, itemID)
	if !used.Equal(decimal.RequireFromString("10")) {
		t.Fatalf("credits_used = %s want 10", used.StringFixed(6))
	}

	// Create report with zero budget cost (nothing to allocate)
	_, _, err = st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "0.000000", ProductCost: "5.000000", Label: "no budget cost"},
	}, false)
	if err != nil {
		t.Fatal(err)
	}

	// Verify NO exhausted outbox event was created (item was already exhausted)
	if got := outboxEventCount(t, st, "budget-item.exhausted", "budget-item.exhausted:"+itemID); got != 0 {
		t.Fatalf("exhausted outbox events = %d want 0 (item was already exhausted)", got)
	}
}

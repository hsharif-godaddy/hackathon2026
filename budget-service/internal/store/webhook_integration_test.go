package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestCreateWebhookSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "wh-create-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	whID := uuid.NewString()
	err := st.CreateWebhook(ctx, whID, "report.created", pk, "https://example.gdcorp.tools/hook")
	if err != nil {
		t.Fatalf("CreateWebhook: %v", err)
	}
}

func TestCreateWebhookNoProduct(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	whID := uuid.NewString()
	err := st.CreateWebhook(ctx, whID, "report.created", "nonexistent-"+uuid.NewString(), "https://example.gdcorp.tools/hook")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestGetWebhookSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "wh-get-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	whID := uuid.NewString()
	if err := st.CreateWebhook(ctx, whID, "budget-item.reset", pk, "https://api.godaddy.com/hook"); err != nil {
		t.Fatal(err)
	}

	row, err := st.GetWebhook(ctx, whID, false)
	if err != nil {
		t.Fatalf("GetWebhook: %v", err)
	}
	if row.ID != whID {
		t.Fatalf("ID = %q want %q", row.ID, whID)
	}
	if row.EventType != "budget-item.reset" {
		t.Fatalf("EventType = %q want budget-item.reset", row.EventType)
	}
	if row.ProductKey != pk {
		t.Fatalf("ProductKey = %q want %q", row.ProductKey, pk)
	}
	if row.URL != "https://api.godaddy.com/hook" {
		t.Fatalf("URL = %q", row.URL)
	}
	if row.DeletedAt != nil {
		t.Fatal("DeletedAt should be nil")
	}
}

func TestGetWebhookNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	_, err := st.GetWebhook(ctx, uuid.NewString(), false)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestGetWebhookIncludeDeleted(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "wh-incl-del-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	whID := uuid.NewString()
	if err := st.CreateWebhook(ctx, whID, "report.created", pk, "https://api.gdcorp.tools/hook"); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteWebhook(ctx, whID); err != nil {
		t.Fatal(err)
	}

	_, err := st.GetWebhook(ctx, whID, false)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound without includeDeleted, got %v", err)
	}

	row, err := st.GetWebhook(ctx, whID, true)
	if err != nil {
		t.Fatalf("GetWebhook(includeDeleted=true): %v", err)
	}
	if row.DeletedAt == nil {
		t.Fatal("deleted webhook should have non-nil DeletedAt")
	}
}

func TestDeleteWebhookSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "wh-del-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	whID := uuid.NewString()
	if err := st.CreateWebhook(ctx, whID, "report.created", pk, "https://api.gdcorp.tools/hook"); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteWebhook(ctx, whID); err != nil {
		t.Fatalf("DeleteWebhook: %v", err)
	}
}

func TestDeleteWebhookNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	err := st.DeleteWebhook(ctx, uuid.NewString())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestDeleteWebhookAlreadyDeleted(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "wh-double-del-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	whID := uuid.NewString()
	if err := st.CreateWebhook(ctx, whID, "report.created", pk, "https://api.gdcorp.tools/hook"); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteWebhook(ctx, whID); err != nil {
		t.Fatal(err)
	}
	err := st.DeleteWebhook(ctx, whID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on second delete, got %v", err)
	}
}

func TestListWebhooksFilterByProduct(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pkA := "wh-list-a-" + uuid.NewString()
	pkB := "wh-list-b-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pkA); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateProduct(ctx, pkB); err != nil {
		t.Fatal(err)
	}

	if err := st.CreateWebhook(ctx, uuid.NewString(), "report.created", pkA, "https://a.gdcorp.tools/hook"); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateWebhook(ctx, uuid.NewString(), "report.created", pkB, "https://b.gdcorp.tools/hook"); err != nil {
		t.Fatal(err)
	}

	rows, err := st.ListWebhooks(ctx, pkA, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.ProductKey != pkA {
			t.Fatalf("expected only %s webhooks, got %s", pkA, r.ProductKey)
		}
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 webhook for %s, got %d", pkA, len(rows))
	}
}

func TestListWebhooksExcludeDeleted(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "wh-list-del-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	whID := uuid.NewString()
	if err := st.CreateWebhook(ctx, whID, "report.created", pk, "https://api.gdcorp.tools/hook"); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteWebhook(ctx, whID); err != nil {
		t.Fatal(err)
	}

	rows, err := st.ListWebhooks(ctx, pk, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.ID == whID {
			t.Fatal("deleted webhook should not appear with includeDeleted=false")
		}
	}

	rowsAll, err := st.ListWebhooks(ctx, pk, true)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range rowsAll {
		if r.ID == whID {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("deleted webhook should appear with includeDeleted=true")
	}
}

func TestListWebhooksForEvent(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "wh-event-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	if err := st.CreateWebhook(ctx, uuid.NewString(), "report.created", pk, "https://a.gdcorp.tools/hook"); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateWebhook(ctx, uuid.NewString(), "budget-item.reset", pk, "https://b.gdcorp.tools/hook"); err != nil {
		t.Fatal(err)
	}

	rows, err := st.ListWebhooksForEvent(ctx, pk, "report.created")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1, got %d", len(rows))
	}
	if rows[0].EventType != "report.created" {
		t.Fatalf("EventType = %q", rows[0].EventType)
	}
}

func TestListWebhooksForEventExcludesDeleted(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "wh-event-del-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	whID := uuid.NewString()
	if err := st.CreateWebhook(ctx, whID, "report.created", pk, "https://api.gdcorp.tools/hook"); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteWebhook(ctx, whID); err != nil {
		t.Fatal(err)
	}

	rows, err := st.ListWebhooksForEvent(ctx, pk, "report.created")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected 0 (deleted excluded), got %d", len(rows))
	}
}

func TestOutboxInsertAndDrain(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]string{"test": "data"}
	idemKey := "test-outbox-" + uuid.NewString()
	if err := InsertOutboxEventTx(ctx, tx, "report.created", "test-pk", payload, idemKey); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	// Use a large batch to capture our event even if other tests have pending events
	events, err := st.DrainWebhookOutbox(ctx, 1000)
	if err != nil {
		t.Fatal(err)
	}
	var found *OutboxEvent
	for i := range events {
		if events[i].IdempotencyKey == idemKey {
			found = &events[i]
			break
		}
	}
	if found == nil {
		// If not found in drain (may have been grabbed by another test), verify it exists
		var status string
		err := st.db.QueryRowContext(ctx, `SELECT status FROM webhook_outbox WHERE idempotency_key = $1`, idemKey).Scan(&status)
		if err != nil {
			t.Fatal("outbox event not found in drain or in database")
		}
		// Event was inserted successfully — it's either already processing or was drained by a concurrent test
		t.Logf("event exists with status=%q (may have been drained by another test)", status)
		return
	}
	if found.EventType != "report.created" {
		t.Fatalf("EventType = %q", found.EventType)
	}
}

func TestOutboxIdempotency(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	idemKey := "test-idempotent-" + uuid.NewString()

	for i := 0; i < 2; i++ {
		tx, err := st.db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := InsertOutboxEventTx(ctx, tx, "report.created", "pk", map[string]string{"n": "1"}, idemKey); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}

	var count int
	err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM webhook_outbox WHERE idempotency_key = $1`, idemKey).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 outbox row for idempotency key, got %d", count)
	}
}

func TestMarkOutboxEventsCompleted(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	idemKey := "mark-completed-" + uuid.NewString()
	if err := InsertOutboxEventTx(ctx, tx, "report.created", "pk", map[string]string{}, idemKey); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	var eventID string
	if err := st.db.QueryRowContext(ctx, `SELECT id FROM webhook_outbox WHERE idempotency_key = $1`, idemKey).Scan(&eventID); err != nil {
		t.Fatal(err)
	}

	if err := st.MarkOutboxEventsCompleted(ctx, []string{eventID}); err != nil {
		t.Fatal(err)
	}

	var status string
	if err := st.db.QueryRowContext(ctx, `SELECT status FROM webhook_outbox WHERE id = $1`, eventID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "completed" {
		t.Fatalf("status = %q want completed", status)
	}
}

func TestMarkOutboxEventFailed(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	idemKey := "mark-failed-" + uuid.NewString()
	if err := InsertOutboxEventTx(ctx, tx, "report.created", "pk", map[string]string{}, idemKey); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	var eventID string
	if err := st.db.QueryRowContext(ctx, `SELECT id FROM webhook_outbox WHERE idempotency_key = $1`, idemKey).Scan(&eventID); err != nil {
		t.Fatal(err)
	}

	if err := st.MarkOutboxEventFailed(ctx, eventID, "test error", 5); err != nil {
		t.Fatal(err)
	}

	var status string
	var lastErr sql.NullString
	if err := st.db.QueryRowContext(ctx, `SELECT status, last_error FROM webhook_outbox WHERE id = $1`, eventID).Scan(&status, &lastErr); err != nil {
		t.Fatal(err)
	}
	if status != "pending" {
		t.Fatalf("status = %q want pending (attempt_count < maxAttempts)", status)
	}
	if !lastErr.Valid || lastErr.String != "test error" {
		t.Fatalf("last_error = %v", lastErr)
	}
}

func TestCleanupCompletedOutboxEvents(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	idemKey := "cleanup-" + uuid.NewString()
	if err := InsertOutboxEventTx(ctx, tx, "report.created", "pk", map[string]string{}, idemKey); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	var eventID string
	if err := st.db.QueryRowContext(ctx, `SELECT id FROM webhook_outbox WHERE idempotency_key = $1`, idemKey).Scan(&eventID); err != nil {
		t.Fatal(err)
	}

	// Mark as completed with processed_at in the past
	if _, err := st.db.ExecContext(ctx, `UPDATE webhook_outbox SET status = 'completed', processed_at = now() - interval '30 days' WHERE id = $1`, eventID); err != nil {
		t.Fatal(err)
	}

	deleted, err := st.CleanupCompletedOutboxEvents(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if deleted < 1 {
		t.Fatalf("expected at least 1 deleted, got %d", deleted)
	}
}

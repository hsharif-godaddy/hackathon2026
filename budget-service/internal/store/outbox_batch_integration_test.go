package store

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestMarkOutboxEventsCompletedBatch(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	id1 := uuid.NewString()
	id2 := uuid.NewString()
	payload, err := json.Marshal(map[string]any{"k": 1})
	if err != nil {
		t.Fatal(err)
	}
	_, err = st.db.ExecContext(ctx, `
		INSERT INTO webhook_outbox (id, event_type, product_key, payload, idempotency_key)
		VALUES
			($1, 'report.created', 'pk-batch', $3, $4),
			($2, 'report.created', 'pk-batch', $3, $5)
	`, id1, id2, payload, "idem:"+id1, "idem:"+id2)
	if err != nil {
		t.Fatal(err)
	}

	if err := st.MarkOutboxEventsCompleted(ctx, []string{id1, id2}); err != nil {
		t.Fatalf("MarkOutboxEventsCompleted: %v", err)
	}

	var n int
	if err := st.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM webhook_outbox WHERE id IN ($1::uuid, $2::uuid) AND status = 'completed'
	`, id1, id2).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("completed rows = %d want 2", n)
	}
}

func TestMarkOutboxEventsFailedBatchMatchesSingleRowSemantics(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	id1 := uuid.NewString()
	payload, err := json.Marshal(map[string]any{"k": 1})
	if err != nil {
		t.Fatal(err)
	}
	_, err = st.db.ExecContext(ctx, `
		INSERT INTO webhook_outbox (id, event_type, product_key, payload, status, attempt_count, idempotency_key)
		VALUES ($1, 'report.created', 'pk-fail', $2, 'processing', 1, $3)
	`, id1, payload, "idem-fail:"+id1)
	if err != nil {
		t.Fatal(err)
	}

	if err := st.MarkOutboxEventsFailed(ctx, []OutboxDeliveryFailure{
		{EventID: id1, ErrMsg: "boom"},
	}, 7); err != nil {
		t.Fatalf("MarkOutboxEventsFailed: %v", err)
	}

	var status string
	var nextNA interface{}
	if err := st.db.QueryRowContext(ctx, `
		SELECT status, next_attempt_at FROM webhook_outbox WHERE id = $1
	`, id1).Scan(&status, &nextNA); err != nil {
		t.Fatal(err)
	}
	if status != "pending" {
		t.Fatalf("status = %q want pending (backoff)", status)
	}
}

func TestMarkOutboxEventsFailedTerminalFailure(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	id := uuid.NewString()
	payload, err := json.Marshal(map[string]any{"k": 1})
	if err != nil {
		t.Fatal(err)
	}
	const maxAttempts = 7
	_, err = st.db.ExecContext(ctx, `
		INSERT INTO webhook_outbox (id, event_type, product_key, payload, status, attempt_count, idempotency_key)
		VALUES ($1, 'report.created', 'pk-fail-term', $2, 'processing', $3, $4)
	`, id, payload, maxAttempts, "idem-term:"+id)
	if err != nil {
		t.Fatal(err)
	}

	if err := st.MarkOutboxEventsFailed(ctx, []OutboxDeliveryFailure{
		{EventID: id, ErrMsg: "terminal"},
	}, maxAttempts); err != nil {
		t.Fatalf("MarkOutboxEventsFailed: %v", err)
	}

	var status string
	var processedAt interface{}
	if err := st.db.QueryRowContext(ctx, `
		SELECT status, processed_at FROM webhook_outbox WHERE id = $1
	`, id).Scan(&status, &processedAt); err != nil {
		t.Fatal(err)
	}
	if status != "failed" {
		t.Fatalf("status = %q want failed", status)
	}
	if processedAt == nil {
		t.Fatal("processed_at is null, want set on terminal failure")
	}
}

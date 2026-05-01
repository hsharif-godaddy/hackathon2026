package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

const listWebhooksRowLimit = 10000

// WebhookRow is a persisted webhook subscription.
type WebhookRow struct {
	ID         string
	EventType  string
	ProductKey string
	URL        string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	DeletedAt  *time.Time
}

func (s *Store) CreateWebhook(ctx context.Context, webhookID, eventType, productKey, targetURL string) error {
	if _, err := uuid.Parse(webhookID); err != nil {
		return err
	}
	pk := strings.TrimSpace(productKey)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var lock int
	err = tx.QueryRowContext(ctx, `
		SELECT 1 FROM products WHERE product_key = $1 AND deleted_at IS NULL FOR UPDATE
	`, pk).Scan(&lock)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO webhooks (id, event_type, product_key, url)
		VALUES ($1, $2, $3, $4)
	`, webhookID, strings.TrimSpace(eventType), pk, strings.TrimSpace(targetURL))
	if err != nil {
		return mapFKNotFound(err)
	}
	return tx.Commit()
}

func (s *Store) DeleteWebhook(ctx context.Context, webhookID string) error {
	if _, err := uuid.Parse(webhookID); err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE webhooks SET deleted_at = now(), updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
	`, webhookID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) GetWebhook(ctx context.Context, webhookID string, includeDeleted bool) (*WebhookRow, error) {
	if _, err := uuid.Parse(webhookID); err != nil {
		return nil, err
	}
	var r WebhookRow
	var del sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT id, event_type, product_key, url, created_at, updated_at, deleted_at
		FROM webhooks
		WHERE id = $1 AND ($2 OR deleted_at IS NULL)
	`, webhookID, includeDeleted).Scan(&r.ID, &r.EventType, &r.ProductKey, &r.URL, &r.CreatedAt, &r.UpdatedAt, &del)
	if err != nil {
		return nil, mapNotFound(err)
	}
	if del.Valid {
		t := del.Time
		r.DeletedAt = &t
	}
	return &r, nil
}

// ListWebhooks returns webhooks, optionally filtered by productKey (trimmed; empty means all).
// When includeDeleted is false, only rows with deleted_at IS NULL are returned.
// Rows are capped at listWebhooksRowLimit (simple guard until pagination exists).
func (s *Store) ListWebhooks(ctx context.Context, productKey string, includeDeleted bool) ([]WebhookRow, error) {
	pk := strings.TrimSpace(productKey)
	var rows *sql.Rows
	var err error
	if pk == "" {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, event_type, product_key, url, created_at, updated_at, deleted_at
			FROM webhooks
			WHERE ($1 OR deleted_at IS NULL)
			ORDER BY created_at, id
			LIMIT $2
		`, includeDeleted, listWebhooksRowLimit)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, event_type, product_key, url, created_at, updated_at, deleted_at
			FROM webhooks
			WHERE ($1 OR deleted_at IS NULL) AND product_key = $2
			ORDER BY created_at, id
			LIMIT $3
		`, includeDeleted, pk, listWebhooksRowLimit)
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []WebhookRow
	for rows.Next() {
		var r WebhookRow
		var del sql.NullTime
		if err := rows.Scan(&r.ID, &r.EventType, &r.ProductKey, &r.URL, &r.CreatedAt, &r.UpdatedAt, &del); err != nil {
			return nil, err
		}
		if del.Valid {
			t := del.Time
			r.DeletedAt = &t
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListWebhooksForEvent returns active webhooks for productKey subscribed to the given event type.
// WebhookRow.DeletedAt is always nil: the query requires deleted_at IS NULL (delivery targets active rows only).
func (s *Store) ListWebhooksForEvent(ctx context.Context, productKey, eventType string) ([]WebhookRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, event_type, product_key, url, created_at, updated_at
		FROM webhooks
		WHERE product_key = $1
		  AND event_type = $2
		  AND deleted_at IS NULL
		ORDER BY created_at, id
	`, strings.TrimSpace(productKey), strings.TrimSpace(eventType))
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []WebhookRow
	for rows.Next() {
		var r WebhookRow
		if err := rows.Scan(&r.ID, &r.EventType, &r.ProductKey, &r.URL, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// OutboxEvent represents a webhook event queued for delivery.
type OutboxEvent struct {
	ID             string
	EventType      string
	ProductKey     string
	Payload        json.RawMessage
	AttemptCount   int
	IdempotencyKey string
	CreatedAt      time.Time
}

// InsertOutboxEvent inserts a webhook event into the outbox within an existing transaction.
// ON CONFLICT DO NOTHING ensures idempotency.
func InsertOutboxEventTx(ctx context.Context, tx *sql.Tx, eventType, productKey string, payload any, idempotencyKey string) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO webhook_outbox (event_type, product_key, payload, idempotency_key)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, eventType, productKey, payloadJSON, idempotencyKey)
	return err
}

// DrainWebhookOutbox retrieves pending/processing events ready for delivery.
// Uses FOR UPDATE SKIP LOCKED to allow concurrent workers.
func (s *Store) DrainWebhookOutbox(ctx context.Context, batchSize int) ([]OutboxEvent, error) {
	if batchSize < 1 {
		batchSize = 100
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `
		UPDATE webhook_outbox
		SET status = 'processing', last_attempt_at = now(), attempt_count = attempt_count + 1
		WHERE id IN (
			SELECT id FROM webhook_outbox
			WHERE status IN ('pending', 'processing')
			  AND next_attempt_at <= now()
			ORDER BY next_attempt_at, id
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, event_type, product_key, payload, attempt_count, idempotency_key, created_at
	`, batchSize)
	if err != nil {
		return nil, err
	}

	var events []OutboxEvent
	for rows.Next() {
		var e OutboxEvent
		if err := rows.Scan(&e.ID, &e.EventType, &e.ProductKey, &e.Payload, &e.AttemptCount, &e.IdempotencyKey, &e.CreatedAt); err != nil {
			_ = rows.Close()
			return nil, err
		}
		events = append(events, e)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return events, nil
}

// OutboxDeliveryFailure pairs an outbox row id with a delivery or parse error message.
type OutboxDeliveryFailure struct {
	EventID string
	ErrMsg  string
}

// MarkOutboxEventsCompleted marks multiple events delivered in one round-trip.
func (s *Store) MarkOutboxEventsCompleted(ctx context.Context, eventIDs []string) error {
	if len(eventIDs) == 0 {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE webhook_outbox
		SET status = 'completed', processed_at = now()
		WHERE id = ANY($1::uuid[])
	`, pq.Array(eventIDs))
	return err
}

// MarkOutboxEventsFailed updates each matching outbox row using the paired err_msg as
// last_error. When attempt_count < maxAttempts: status pending, next_attempt_at =
// now() + (2^attempt_count) minutes. When attempt_count >= maxAttempts: status failed,
// processed_at = now(), next_attempt_at unchanged.
func (s *Store) MarkOutboxEventsFailed(ctx context.Context, failures []OutboxDeliveryFailure, maxAttempts int) error {
	if len(failures) == 0 {
		return nil
	}
	ids := make([]string, len(failures))
	msgs := make([]string, len(failures))
	for i := range failures {
		ids[i] = failures[i].EventID
		msgs[i] = failures[i].ErrMsg
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE webhook_outbox o
		SET
			status = CASE WHEN o.attempt_count >= $1 THEN 'failed' ELSE 'pending' END,
			last_error = v.err_msg,
			next_attempt_at = CASE
				WHEN o.attempt_count >= $1 THEN o.next_attempt_at
				ELSE now() + (power(2, o.attempt_count) * interval '1 minute')
			END,
			processed_at = CASE WHEN o.attempt_count >= $1 THEN now() ELSE o.processed_at END
		FROM unnest($2::uuid[], $3::text[]) AS v(id, err_msg)
		WHERE o.id = v.id
	`, maxAttempts, pq.Array(ids), pq.Array(msgs))
	return err
}

// MarkOutboxEventCompleted marks an event as successfully delivered.
func (s *Store) MarkOutboxEventCompleted(ctx context.Context, eventID string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE webhook_outbox
		SET status = 'completed', processed_at = now()
		WHERE id = $1
	`, eventID)
	return err
}

// MarkOutboxEventFailed marks an event as failed with exponential backoff or final failure.
// Backoff when attempt_count < maxAttempts: now() + (2^attempt_count) minutes (2m, 4m, 8m, …).
func (s *Store) MarkOutboxEventFailed(ctx context.Context, eventID string, errMsg string, maxAttempts int) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE webhook_outbox
		SET
			status = CASE WHEN attempt_count >= $2 THEN 'failed' ELSE 'pending' END,
			last_error = $3,
			next_attempt_at = CASE
				WHEN attempt_count >= $2 THEN next_attempt_at
				ELSE now() + (power(2, attempt_count) * interval '1 minute')
			END,
			processed_at = CASE WHEN attempt_count >= $2 THEN now() ELSE processed_at END
		WHERE id = $1
	`, eventID, maxAttempts, errMsg)
	return err
}

// CleanupCompletedOutboxEvents removes old completed/failed events.
// Returns the number of rows deleted.
func (s *Store) CleanupCompletedOutboxEvents(ctx context.Context, retentionDays int) (int64, error) {
	if retentionDays < 1 {
		retentionDays = 7
	}
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM webhook_outbox
		WHERE status IN ('completed', 'failed')
		  AND processed_at < now() - ($1 * interval '1 day')
	`, retentionDays)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

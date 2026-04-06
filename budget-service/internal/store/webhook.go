package store

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
)

// WebhookRow is a persisted webhook subscription.
type WebhookRow struct {
	ID         string
	EventType  string
	ProductKey string
	URL        string
	CreatedAt  time.Time
}

func (s *Store) CreateWebhook(ctx context.Context, webhookID, eventType, productKey, targetURL string) error {
	if _, err := uuid.Parse(webhookID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO webhooks (id, event_type, product_key, url)
		VALUES ($1, $2, $3, $4)
	`, webhookID, strings.TrimSpace(eventType), strings.TrimSpace(productKey), strings.TrimSpace(targetURL))
	if err != nil {
		return mapFKNotFound(err)
	}
	return nil
}

func (s *Store) DeleteWebhook(ctx context.Context, webhookID string) error {
	if _, err := uuid.Parse(webhookID); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `
		INSERT INTO webhooks_history (webhook_id, event_type, product_key, url, created_at)
		SELECT id, event_type, product_key, url, created_at FROM webhooks WHERE id = $1
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
	if _, err := tx.ExecContext(ctx, `DELETE FROM webhooks WHERE id = $1`, webhookID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetWebhook(ctx context.Context, webhookID string) (*WebhookRow, error) {
	if _, err := uuid.Parse(webhookID); err != nil {
		return nil, err
	}
	var r WebhookRow
	err := s.db.QueryRowContext(ctx, `
		SELECT id, event_type, product_key, url, created_at
		FROM webhooks WHERE id = $1
	`, webhookID).Scan(&r.ID, &r.EventType, &r.ProductKey, &r.URL, &r.CreatedAt)
	if err != nil {
		return nil, mapNotFound(err)
	}
	return &r, nil
}

// ListWebhooksForReportCreated returns webhooks for productKey subscribed to report.created (or reportCreated).
func (s *Store) ListWebhooksForReportCreated(ctx context.Context, productKey string) ([]WebhookRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, event_type, product_key, url, created_at
		FROM webhooks
		WHERE product_key = $1
		  AND lower(trim(event_type)) IN ('report.created', 'reportcreated')
		ORDER BY created_at, id
	`, strings.TrimSpace(productKey))
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []WebhookRow
	for rows.Next() {
		var r WebhookRow
		if err := rows.Scan(&r.ID, &r.EventType, &r.ProductKey, &r.URL, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

package store

import (
	"context"
	"database/sql"
	"errors"
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
	UpdatedAt  time.Time
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

func (s *Store) GetWebhook(ctx context.Context, webhookID string) (*WebhookRow, error) {
	if _, err := uuid.Parse(webhookID); err != nil {
		return nil, err
	}
	var r WebhookRow
	err := s.db.QueryRowContext(ctx, `
		SELECT id, event_type, product_key, url, created_at, updated_at
		FROM webhooks WHERE id = $1 AND deleted_at IS NULL
	`, webhookID).Scan(&r.ID, &r.EventType, &r.ProductKey, &r.URL, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, mapNotFound(err)
	}
	return &r, nil
}

// ListWebhooksForReportCreated returns active webhooks for productKey subscribed to report.created (or reportCreated).
func (s *Store) ListWebhooksForReportCreated(ctx context.Context, productKey string) ([]WebhookRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, event_type, product_key, url, created_at, updated_at
		FROM webhooks
		WHERE product_key = $1
		  AND deleted_at IS NULL
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
		if err := rows.Scan(&r.ID, &r.EventType, &r.ProductKey, &r.URL, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

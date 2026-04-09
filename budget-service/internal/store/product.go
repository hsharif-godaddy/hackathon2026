package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ProductRow is a registered product key and timestamps.
type ProductRow struct {
	ProductKey string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// ListProducts returns active registered products ordered by product_key.
func (s *Store) ListProducts(ctx context.Context) ([]ProductRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT product_key, created_at, updated_at
		FROM products
		WHERE deleted_at IS NULL
		ORDER BY product_key
	`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := make([]ProductRow, 0)
	for rows.Next() {
		var r ProductRow
		if err := rows.Scan(&r.ProductKey, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CreateProduct inserts a new product key, or clears deleted_at on a soft-deleted row.
// ErrConflict when an active row already exists for productKey.
func (s *Store) CreateProduct(ctx context.Context, productKey string) (ProductRow, error) {
	var r ProductRow
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO products (product_key) VALUES ($1)
		ON CONFLICT (product_key) DO UPDATE SET
			deleted_at = NULL,
			updated_at = now()
		WHERE products.deleted_at IS NOT NULL
		RETURNING product_key, created_at, updated_at
	`, productKey).Scan(&r.ProductKey, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ProductRow{}, ErrConflict
		}
		return ProductRow{}, err
	}
	return r, nil
}

// SoftDeleteProduct sets deleted_at when no active budgets reference the product.
func (s *Store) SoftDeleteProduct(ctx context.Context, productKey string) error {
	res, err := s.db.ExecContext(ctx, `
		UPDATE products SET deleted_at = now(), updated_at = now()
		WHERE product_key = $1 AND deleted_at IS NULL
		  AND NOT EXISTS (
		    SELECT 1 FROM budgets WHERE product_key = $1 AND deleted_at IS NULL
		  )
	`, productKey)
	if err != nil {
		return err
	}
	naff, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if naff > 0 {
		return nil
	}
	var del sql.NullTime
	err = s.db.QueryRowContext(ctx, `
		SELECT deleted_at FROM products WHERE product_key = $1
	`, productKey).Scan(&del)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if del.Valid {
		return ErrNotFound
	}
	return ErrProductHasActiveBudgets
}

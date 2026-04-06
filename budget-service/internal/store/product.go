package store

import (
	"context"
	"errors"
	"time"

	"github.com/lib/pq"
)

// ProductRow is a registered product key and timestamps.
type ProductRow struct {
	ProductKey string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func mapUniqueViolation(err error) error {
	var pqErr *pq.Error
	if errors.As(err, &pqErr) && pqErr.Code == "23505" {
		return ErrConflict
	}
	return err
}

// ListProducts returns all registered products ordered by product_key.
func (s *Store) ListProducts(ctx context.Context) ([]ProductRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT product_key, created_at, updated_at
		FROM products
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

// CreateProduct inserts a new product key. Duplicate key returns ErrConflict.
func (s *Store) CreateProduct(ctx context.Context, productKey string) (ProductRow, error) {
	var r ProductRow
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO products (product_key) VALUES ($1)
		RETURNING product_key, created_at, updated_at
	`, productKey).Scan(&r.ProductKey, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return ProductRow{}, mapUniqueViolation(err)
	}
	return r, nil
}

// SoftDeleteProduct archives the product to products_history and deletes the row if no budgets reference it.
func (s *Store) SoftDeleteProduct(ctx context.Context, productKey string) error {
	var n int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM budgets WHERE product_key = $1
	`, productKey).Scan(&n)
	if err != nil {
		return err
	}
	if n > 0 {
		return ErrProductHasActiveBudgets
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `
		INSERT INTO products_history (product_key, created_at)
		SELECT product_key, created_at FROM products WHERE product_key = $1
	`, productKey)
	if err != nil {
		return err
	}
	naff, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if naff == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM products WHERE product_key = $1`, productKey); err != nil {
		return err
	}
	return tx.Commit()
}

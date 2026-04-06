// Package store is Postgres persistence for budgets, items, sessions, reports, products, webhooks.
package store

import (
	"context"
	"database/sql"
)

// Store wraps the application DB pool.
type Store struct {
	db *sql.DB
}

// New wraps db for store operations.
func New(db *sql.DB) *Store {
	return &Store{db: db}
}

// Ping runs a single round-trip to the server.
func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

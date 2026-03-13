package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	// Register the pure-Go SQLite driver so database/sql can open "sqlite" databases.
	_ "modernc.org/sqlite"
)

// ErrNotFound is returned when a query expects a row but finds none.
var ErrNotFound = errors.New("not found")

// Open opens a SQLite database at the given path and applies pragmas and schema
// migrations. The schema is compatible with the TypeScript agent's database
// (agents/src/database/schema.ts) so both can share the same DB file.
func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}

	// SQLite does not support concurrent writers from multiple connections.
	// A single connection also ensures pragmas are applied consistently.
	db.SetMaxOpenConns(1)

	ctx := context.Background()

	if err := applyPragmas(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("applying pragmas: %w", err)
	}

	if err := migrate(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("running migrations: %w", err)
	}

	return db, nil
}

func applyPragmas(ctx context.Context, db *sql.DB) error {
	// With SetMaxOpenConns(1), all pragmas are applied to the single
	// connection and persist for the lifetime of the pool.
	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
		"PRAGMA cache_size=1000",
	}
	for _, p := range pragmas {
		if _, err := db.ExecContext(ctx, p); err != nil {
			return fmt.Errorf("%s: %w", p, err)
		}
	}
	return nil
}

func migrate(ctx context.Context, db *sql.DB) error {
	for _, stmt := range schema {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("executing migration: %w", err)
		}
	}
	return nil
}

// schema contains the CREATE TABLE and CREATE INDEX statements matching the TS
// agent's schema.ts. Only tables needed for Phase 1 are included; additional
// tables (memory, import_jobs, summaries, etc.) will be added as needed.
var schema = []string{
	// --- apps ---
	`CREATE TABLE IF NOT EXISTS apps (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		path TEXT NOT NULL,
		port INTEGER NOT NULL DEFAULT 5000,
		socket_path TEXT,
		publish_supervisor_path TEXT,
		preview_url TEXT,
		initial_prompt TEXT,
		template_version TEXT,
		subscription_id TEXT,
		customer_id TEXT,
		status TEXT NOT NULL DEFAULT 'creating'
			CHECK(status IN ('creating', 'created', 'error')),
		initial_build_complete BOOLEAN DEFAULT FALSE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE INDEX IF NOT EXISTS idx_apps_created_at ON apps(created_at)`,

	// --- conversations ---
	`CREATE TABLE IF NOT EXISTS conversations (
		id TEXT PRIMARY KEY,
		app_id TEXT NOT NULL,
		agent_id TEXT NOT NULL,
		title TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
	)`,
	`CREATE INDEX IF NOT EXISTS idx_conversations_app_id ON conversations(app_id)`,
	`CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at)`,

	// --- conversation_messages ---
	`CREATE TABLE IF NOT EXISTS conversation_messages (
		id TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL,
		sender TEXT NOT NULL CHECK(sender IN ('user', 'agent')),
		content TEXT NOT NULL,
		message_type TEXT,
		tool_calls TEXT,
		segments TEXT,
		metadata TEXT,
		context_attachments TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
	)`,
	`CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
		ON conversation_messages(conversation_id)`,
	`CREATE INDEX IF NOT EXISTS idx_messages_created_at
		ON conversation_messages(created_at)`,
}

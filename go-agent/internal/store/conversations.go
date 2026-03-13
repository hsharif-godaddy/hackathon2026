package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Conversation represents a row in the conversations table.
type Conversation struct {
	ID        string
	AppID     string
	AgentID   string
	Title     *string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// ConversationRepo provides CRUD operations for conversations.
type ConversationRepo struct {
	db *sql.DB
}

// NewConversationRepo creates a new ConversationRepo.
func NewConversationRepo(db *sql.DB) *ConversationRepo {
	return &ConversationRepo{db: db}
}

// Create inserts a new conversation and returns it.
func (r *ConversationRepo) Create(
	ctx context.Context, id, appID, agentID string, title *string,
) (*Conversation, error) {
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO conversations (id, app_id, agent_id, title, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, appID, agentID, title, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("creating conversation: %w", err)
	}
	return &Conversation{
		ID:        id,
		AppID:     appID,
		AgentID:   agentID,
		Title:     title,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

// GetByID returns a single conversation by ID.
func (r *ConversationRepo) GetByID(ctx context.Context, id string) (*Conversation, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, app_id, agent_id, title, created_at, updated_at
		 FROM conversations WHERE id = ?`, id,
	)
	return scanConversation(row)
}

// GetByAppID returns all conversations for the given app, ordered by created_at DESC.
func (r *ConversationRepo) GetByAppID(ctx context.Context, appID string) ([]Conversation, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, app_id, agent_id, title, created_at, updated_at
		 FROM conversations WHERE app_id = ? ORDER BY created_at DESC, id DESC`, appID,
	)
	if err != nil {
		return nil, fmt.Errorf("querying conversations: %w", err)
	}
	defer rows.Close()

	convos := []Conversation{}
	for rows.Next() {
		var c Conversation
		if err := rows.Scan(&c.ID, &c.AppID, &c.AgentID, &c.Title, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scanning conversation: %w", err)
		}
		convos = append(convos, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating conversations: %w", err)
	}
	return convos, nil
}

// GetLatestForApp returns the most recently updated conversation for the app.
func (r *ConversationRepo) GetLatestForApp(ctx context.Context, appID string) (*Conversation, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, app_id, agent_id, title, created_at, updated_at
		 FROM conversations WHERE app_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`, appID,
	)
	return scanConversation(row)
}

// UpdateTitle updates the title of a conversation.
func (r *ConversationRepo) UpdateTitle(ctx context.Context, id, title string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`,
		title, time.Now().UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("updating title: %w", err)
	}
	return expectOneRow(res, "conversation", id)
}

// UpdateAgentID updates the agent_id (used for agent handoff).
func (r *ConversationRepo) UpdateAgentID(ctx context.Context, id, agentID string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE conversations SET agent_id = ?, updated_at = ? WHERE id = ?`,
		agentID, time.Now().UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("updating agent_id: %w", err)
	}
	return expectOneRow(res, "conversation", id)
}

// Delete removes a conversation (cascades to messages).
func (r *ConversationRepo) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM conversations WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting conversation: %w", err)
	}
	return expectOneRow(res, "conversation", id)
}

func scanConversation(row *sql.Row) (*Conversation, error) {
	var c Conversation
	err := row.Scan(&c.ID, &c.AppID, &c.AgentID, &c.Title, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("conversation: %w", ErrNotFound)
		}
		return nil, fmt.Errorf("scanning conversation: %w", err)
	}
	return &c, nil
}

func expectOneRow(res sql.Result, entity, id string) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("%s %q: %w", entity, id, ErrNotFound)
	}
	return nil
}

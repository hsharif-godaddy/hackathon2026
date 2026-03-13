package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"time"
)

// Message represents a row in the conversation_messages table.
type Message struct {
	ID                 string
	ConversationID     string
	Sender             string
	Content            string
	MessageType        *string
	ToolCalls          json.RawMessage
	Segments           json.RawMessage
	Metadata           json.RawMessage
	ContextAttachments json.RawMessage
	CreatedAt          time.Time
}

// AddMessageOptions contains optional fields when adding a message.
type AddMessageOptions struct {
	MessageType        *string
	ToolCalls          json.RawMessage
	Segments           json.RawMessage
	Metadata           json.RawMessage
	ContextAttachments json.RawMessage
}

// MessageRepo provides CRUD operations for conversation messages.
type MessageRepo struct {
	db *sql.DB
}

// NewMessageRepo creates a new MessageRepo.
func NewMessageRepo(db *sql.DB) *MessageRepo {
	return &MessageRepo{db: db}
}

// Add inserts a new message into the conversation.
func (r *MessageRepo) Add(
	ctx context.Context, id, conversationID, sender, content string, opts *AddMessageOptions,
) (*Message, error) {
	now := time.Now().UTC()
	m := &Message{
		ID:             id,
		ConversationID: conversationID,
		Sender:         sender,
		Content:        content,
		CreatedAt:      now,
	}

	if opts != nil {
		m.MessageType = opts.MessageType
		m.ToolCalls = opts.ToolCalls
		m.Segments = opts.Segments
		m.Metadata = opts.Metadata
		m.ContextAttachments = opts.ContextAttachments
	}

	_, err := r.db.ExecContext(ctx,
		`INSERT INTO conversation_messages
			(id, conversation_id, sender, content, message_type,
			 tool_calls, segments, metadata, context_attachments, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.ConversationID, m.Sender, m.Content, m.MessageType,
		nullableJSON(m.ToolCalls), nullableJSON(m.Segments),
		nullableJSON(m.Metadata), nullableJSON(m.ContextAttachments),
		now,
	)
	if err != nil {
		return nil, fmt.Errorf("adding message: %w", err)
	}
	return m, nil
}

// GetByID returns a single message by ID.
func (r *MessageRepo) GetByID(ctx context.Context, id string) (*Message, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, conversation_id, sender, content, message_type,
				tool_calls, segments, metadata, context_attachments, created_at
		 FROM conversation_messages WHERE id = ?`, id,
	)
	return scanMessage(row)
}

// GetByConversationID returns all messages in a conversation, ordered by created_at ASC.
func (r *MessageRepo) GetByConversationID(ctx context.Context, conversationID string) ([]Message, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, conversation_id, sender, content, message_type,
				tool_calls, segments, metadata, context_attachments, created_at
		 FROM conversation_messages
		 WHERE conversation_id = ?
		 ORDER BY created_at ASC, rowid ASC`, conversationID,
	)
	if err != nil {
		return nil, fmt.Errorf("querying messages: %w", err)
	}
	defer rows.Close()

	msgs := []Message{}
	for rows.Next() {
		var m Message
		var toolCalls, segments, metadata, contextAttachments sql.NullString
		if err := rows.Scan(
			&m.ID, &m.ConversationID, &m.Sender, &m.Content, &m.MessageType,
			&toolCalls, &segments, &metadata, &contextAttachments, &m.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning message: %w", err)
		}
		m.ToolCalls = nullStringToJSON(toolCalls)
		m.Segments = nullStringToJSON(segments)
		m.Metadata = nullStringToJSON(metadata)
		m.ContextAttachments = nullStringToJSON(contextAttachments)
		msgs = append(msgs, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating messages: %w", err)
	}
	return msgs, nil
}

// GetCount returns the number of messages in a conversation.
func (r *MessageRepo) GetCount(ctx context.Context, conversationID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = ?`,
		conversationID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("counting messages: %w", err)
	}
	return count, nil
}

// UpdateMetadata merges the given metadata updates into the message's existing metadata.
func (r *MessageRepo) UpdateMetadata(ctx context.Context, id string, updates json.RawMessage) error {
	if len(updates) == 0 {
		return nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // rollback after commit is a no-op

	var existing sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT metadata FROM conversation_messages WHERE id = ?`, id,
	).Scan(&existing)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("message %q: %w", id, ErrNotFound)
		}
		return fmt.Errorf("reading metadata for message %q: %w", id, err)
	}

	merged, err := mergeJSON(nullStringToJSON(existing), updates)
	if err != nil {
		return fmt.Errorf("merging metadata: %w", err)
	}

	_, err = tx.ExecContext(ctx,
		`UPDATE conversation_messages SET metadata = ? WHERE id = ?`,
		string(merged), id,
	)
	if err != nil {
		return fmt.Errorf("updating metadata: %w", err)
	}

	return tx.Commit()
}

// Delete removes a message by ID.
func (r *MessageRepo) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM conversation_messages WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting message: %w", err)
	}
	return expectOneRow(res, "message", id)
}

func scanMessage(row *sql.Row) (*Message, error) {
	var m Message
	var toolCalls, segments, metadata, contextAttachments sql.NullString
	err := row.Scan(
		&m.ID, &m.ConversationID, &m.Sender, &m.Content, &m.MessageType,
		&toolCalls, &segments, &metadata, &contextAttachments, &m.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("message: %w", ErrNotFound)
		}
		return nil, fmt.Errorf("scanning message: %w", err)
	}
	m.ToolCalls = nullStringToJSON(toolCalls)
	m.Segments = nullStringToJSON(segments)
	m.Metadata = nullStringToJSON(metadata)
	m.ContextAttachments = nullStringToJSON(contextAttachments)
	return &m, nil
}

// nullableJSON returns nil for empty/null JSON, otherwise the raw bytes as a string.
func nullableJSON(data json.RawMessage) any {
	if len(data) == 0 {
		return nil
	}
	return string(data)
}

// nullStringToJSON converts a sql.NullString back to json.RawMessage.
func nullStringToJSON(ns sql.NullString) json.RawMessage {
	if !ns.Valid {
		return nil
	}
	return json.RawMessage(ns.String)
}

// mergeJSON merges two JSON objects. Keys in updates overwrite keys in base.
// Returns base unchanged if updates is empty/nil.
func mergeJSON(base, updates json.RawMessage) (json.RawMessage, error) {
	if len(updates) == 0 {
		return base, nil
	}

	baseMap := make(map[string]json.RawMessage)
	if len(base) > 0 {
		if err := json.Unmarshal(base, &baseMap); err != nil {
			return nil, err
		}
	}

	updateMap := make(map[string]json.RawMessage)
	if err := json.Unmarshal(updates, &updateMap); err != nil {
		return nil, err
	}

	maps.Copy(baseMap, updateMap)

	return json.Marshal(baseMap)
}

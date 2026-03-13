package store

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupMessageTest(t *testing.T) *MessageRepo {
	t.Helper()
	db := openTestDB(t)
	convRepo := NewConversationRepo(db)
	_, err := convRepo.Create(bg, "conv1", "app1", "develop", nil)
	require.NoError(t, err)
	return NewMessageRepo(db)
}

func TestMessage_Add(t *testing.T) {
	msgRepo := setupMessageTest(t)

	m, err := msgRepo.Add(bg, "msg1", "conv1", "user", "Hello", nil)

	require.NoError(t, err)
	assert.Equal(t, "msg1", m.ID)
	assert.Equal(t, "conv1", m.ConversationID)
	assert.Equal(t, "user", m.Sender)
	assert.Equal(t, "Hello", m.Content)
	assert.False(t, m.CreatedAt.IsZero())
}

func TestMessage_Add_WithOptions(t *testing.T) {
	msgRepo := setupMessageTest(t)

	msgType := "tool_result"
	toolCalls := json.RawMessage(`[{"name":"readFile","input":{"path":"foo.txt"}}]`)
	metadata := json.RawMessage(`{"duration_ms":42}`)

	m, err := msgRepo.Add(bg, "msg1", "conv1", "agent", "file content", &AddMessageOptions{
		MessageType: &msgType,
		ToolCalls:   toolCalls,
		Metadata:    metadata,
	})

	require.NoError(t, err)
	require.NotNil(t, m.MessageType)
	assert.Equal(t, "tool_result", *m.MessageType)
	assert.JSONEq(t, `[{"name":"readFile","input":{"path":"foo.txt"}}]`, string(m.ToolCalls))
	assert.JSONEq(t, `{"duration_ms":42}`, string(m.Metadata))
}

func TestMessage_GetByID(t *testing.T) {
	msgRepo := setupMessageTest(t)

	_, err := msgRepo.Add(bg, "msg1", "conv1", "user", "Hello", nil)
	require.NoError(t, err)

	m, err := msgRepo.GetByID(bg, "msg1")
	require.NoError(t, err)
	assert.Equal(t, "msg1", m.ID)
	assert.Equal(t, "Hello", m.Content)
}

func TestMessage_GetByID_NotFound(t *testing.T) {
	msgRepo := setupMessageTest(t)

	_, err := msgRepo.GetByID(bg, "nonexistent")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestMessage_GetByConversationID(t *testing.T) {
	msgRepo := setupMessageTest(t)

	_, err := msgRepo.Add(bg, "msg1", "conv1", "user", "Hello", nil)
	require.NoError(t, err)
	_, err = msgRepo.Add(bg, "msg2", "conv1", "agent", "Hi there", nil)
	require.NoError(t, err)

	msgs, err := msgRepo.GetByConversationID(bg, "conv1")
	require.NoError(t, err)
	require.Len(t, msgs, 2)
	// Ordered by created_at ASC.
	assert.Equal(t, "msg1", msgs[0].ID)
	assert.Equal(t, "msg2", msgs[1].ID)
}

func TestMessage_GetByConversationID_Empty(t *testing.T) {
	msgRepo := setupMessageTest(t)

	msgs, err := msgRepo.GetByConversationID(bg, "conv1")
	require.NoError(t, err)
	assert.Empty(t, msgs)
}

func TestMessage_GetByConversationID_JSONFields(t *testing.T) {
	msgRepo := setupMessageTest(t)

	toolCalls := json.RawMessage(`[{"name":"grep"}]`)
	_, err := msgRepo.Add(bg, "msg1", "conv1", "agent", "result", &AddMessageOptions{
		ToolCalls: toolCalls,
	})
	require.NoError(t, err)

	msgs, err := msgRepo.GetByConversationID(bg, "conv1")
	require.NoError(t, err)
	require.Len(t, msgs, 1)
	assert.JSONEq(t, `[{"name":"grep"}]`, string(msgs[0].ToolCalls))
	assert.Nil(t, msgs[0].Metadata)
}

func TestMessage_GetCount(t *testing.T) {
	msgRepo := setupMessageTest(t)

	_, err := msgRepo.Add(bg, "msg1", "conv1", "user", "Hello", nil)
	require.NoError(t, err)
	_, err = msgRepo.Add(bg, "msg2", "conv1", "agent", "Hi", nil)
	require.NoError(t, err)

	count, err := msgRepo.GetCount(bg, "conv1")
	require.NoError(t, err)
	assert.Equal(t, 2, count)
}

func TestMessage_UpdateMetadata(t *testing.T) {
	msgRepo := setupMessageTest(t)

	initial := json.RawMessage(`{"a":1}`)
	_, err := msgRepo.Add(bg, "msg1", "conv1", "user", "Hello", &AddMessageOptions{
		Metadata: initial,
	})
	require.NoError(t, err)

	err = msgRepo.UpdateMetadata(bg, "msg1", json.RawMessage(`{"b":2}`))
	require.NoError(t, err)

	m, err := msgRepo.GetByID(bg, "msg1")
	require.NoError(t, err)
	assert.JSONEq(t, `{"a":1,"b":2}`, string(m.Metadata))
}

func TestMessage_UpdateMetadata_NilBase(t *testing.T) {
	msgRepo := setupMessageTest(t)

	_, err := msgRepo.Add(bg, "msg1", "conv1", "user", "Hello", nil)
	require.NoError(t, err)

	err = msgRepo.UpdateMetadata(bg, "msg1", json.RawMessage(`{"key":"val"}`))
	require.NoError(t, err)

	m, err := msgRepo.GetByID(bg, "msg1")
	require.NoError(t, err)
	assert.JSONEq(t, `{"key":"val"}`, string(m.Metadata))
}

func TestMessage_UpdateMetadata_NotFound(t *testing.T) {
	msgRepo := setupMessageTest(t)

	err := msgRepo.UpdateMetadata(bg, "nonexistent", json.RawMessage(`{}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestMessage_Delete(t *testing.T) {
	msgRepo := setupMessageTest(t)

	_, err := msgRepo.Add(bg, "msg1", "conv1", "user", "Hello", nil)
	require.NoError(t, err)

	err = msgRepo.Delete(bg, "msg1")
	require.NoError(t, err)

	_, err = msgRepo.GetByID(bg, "msg1")
	require.Error(t, err)
}

func TestMessage_Delete_NotFound(t *testing.T) {
	msgRepo := setupMessageTest(t)

	err := msgRepo.Delete(bg, "nonexistent")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

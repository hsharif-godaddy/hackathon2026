package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var bg = context.Background()

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	require.NoError(t, err)
	t.Cleanup(func() { db.Close() })

	// Insert a test app so foreign key constraints are satisfied.
	_, err = db.ExecContext(bg,
		`INSERT INTO apps (id, name, path, status) VALUES ('app1', 'Test App', '/tmp/app1', 'created')`,
	)
	require.NoError(t, err)
	return db
}

func TestConversation_Create(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	title := "My chat"
	c, err := repo.Create(bg, "conv1", "app1", "develop", &title)

	require.NoError(t, err)
	assert.Equal(t, "conv1", c.ID)
	assert.Equal(t, "app1", c.AppID)
	assert.Equal(t, "develop", c.AgentID)
	require.NotNil(t, c.Title)
	assert.Equal(t, "My chat", *c.Title)
	assert.False(t, c.CreatedAt.IsZero())
}

func TestConversation_CreateNilTitle(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	c, err := repo.Create(bg, "conv1", "app1", "develop", nil)

	require.NoError(t, err)
	assert.Nil(t, c.Title)
}

func TestConversation_GetByID(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	title := "Test"
	_, err := repo.Create(bg, "conv1", "app1", "develop", &title)
	require.NoError(t, err)

	c, err := repo.GetByID(bg, "conv1")
	require.NoError(t, err)
	assert.Equal(t, "conv1", c.ID)
	assert.Equal(t, "Test", *c.Title)
}

func TestConversation_GetByID_NotFound(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	_, err := repo.GetByID(bg, "nonexistent")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestConversation_GetByAppID(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	_, err := repo.Create(bg, "conv1", "app1", "develop", nil)
	require.NoError(t, err)
	_, err = repo.Create(bg, "conv2", "app1", "develop", nil)
	require.NoError(t, err)

	convos, err := repo.GetByAppID(bg, "app1")
	require.NoError(t, err)
	assert.Len(t, convos, 2)
	// Most recent first.
	assert.Equal(t, "conv2", convos[0].ID)
	assert.Equal(t, "conv1", convos[1].ID)
}

func TestConversation_GetByAppID_Empty(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	convos, err := repo.GetByAppID(bg, "app1")
	require.NoError(t, err)
	assert.Empty(t, convos)
}

func TestConversation_GetLatestForApp(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	_, err := repo.Create(bg, "conv1", "app1", "develop", nil)
	require.NoError(t, err)
	_, err = repo.Create(bg, "conv2", "app1", "develop", nil)
	require.NoError(t, err)

	// Update conv1 so it becomes the latest.
	err = repo.UpdateTitle(bg, "conv1", "Updated")
	require.NoError(t, err)

	c, err := repo.GetLatestForApp(bg, "app1")
	require.NoError(t, err)
	assert.Equal(t, "conv1", c.ID)
}

func TestConversation_UpdateTitle(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	_, err := repo.Create(bg, "conv1", "app1", "develop", nil)
	require.NoError(t, err)

	err = repo.UpdateTitle(bg, "conv1", "New title")
	require.NoError(t, err)

	c, err := repo.GetByID(bg, "conv1")
	require.NoError(t, err)
	require.NotNil(t, c.Title)
	assert.Equal(t, "New title", *c.Title)
}

func TestConversation_UpdateTitle_NotFound(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	err := repo.UpdateTitle(bg, "nonexistent", "title")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestConversation_UpdateAgentID(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	_, err := repo.Create(bg, "conv1", "app1", "develop", nil)
	require.NoError(t, err)

	err = repo.UpdateAgentID(bg, "conv1", "commerce")
	require.NoError(t, err)

	c, err := repo.GetByID(bg, "conv1")
	require.NoError(t, err)
	assert.Equal(t, "commerce", c.AgentID)
}

func TestConversation_Delete(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	_, err := repo.Create(bg, "conv1", "app1", "develop", nil)
	require.NoError(t, err)

	err = repo.Delete(bg, "conv1")
	require.NoError(t, err)

	_, err = repo.GetByID(bg, "conv1")
	require.Error(t, err)
}

func TestConversation_Delete_NotFound(t *testing.T) {
	db := openTestDB(t)
	repo := NewConversationRepo(db)

	err := repo.Delete(bg, "nonexistent")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestConversation_Delete_CascadesMessages(t *testing.T) {
	db := openTestDB(t)
	convRepo := NewConversationRepo(db)
	msgRepo := NewMessageRepo(db)

	_, err := convRepo.Create(bg, "conv1", "app1", "develop", nil)
	require.NoError(t, err)
	_, err = msgRepo.Add(bg, "msg1", "conv1", "user", "Hello", nil)
	require.NoError(t, err)

	err = convRepo.Delete(bg, "conv1")
	require.NoError(t, err)

	// Message should be gone due to CASCADE.
	_, err = msgRepo.GetByID(bg, "msg1")
	require.Error(t, err)
}

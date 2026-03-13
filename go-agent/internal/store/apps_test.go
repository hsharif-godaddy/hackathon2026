package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func openTestDBNoApp(t *testing.T) *sql.DB {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	require.NoError(t, err)
	t.Cleanup(func() { db.Close() })
	return db
}

func TestApp_Create(t *testing.T) {
	db := openTestDBNoApp(t)
	repo := NewAppRepo(db)

	app, err := repo.Create(bg, App{
		ID:   "app1",
		Name: "Test App",
		Path: "/tmp/app1",
	})

	require.NoError(t, err)
	assert.Equal(t, "app1", app.ID)
	assert.Equal(t, "Test App", app.Name)
	assert.Equal(t, "/tmp/app1", app.Path)
	assert.Equal(t, 5000, app.Port)
	assert.Equal(t, "creating", app.Status)
	assert.False(t, app.InitialBuildComplete)
	assert.False(t, app.CreatedAt.IsZero())
}

func TestApp_Create_WithAllFields(t *testing.T) {
	db := openTestDBNoApp(t)
	repo := NewAppRepo(db)

	socketPath := "/var/run/supervisor.sock"
	templateVer := "v8"
	subID := "sub-123"
	custID := "cust-456"

	app, err := repo.Create(bg, App{
		ID:              "app1",
		Name:            "Full App",
		Path:            "/tmp/app1",
		Port:            3000,
		SocketPath:      &socketPath,
		TemplateVersion: &templateVer,
		SubscriptionID:  &subID,
		CustomerID:      &custID,
		Status:          "created",
	})

	require.NoError(t, err)
	assert.Equal(t, 3000, app.Port)
	assert.Equal(t, "created", app.Status)
	require.NotNil(t, app.SocketPath)
	assert.Equal(t, "/var/run/supervisor.sock", *app.SocketPath)
}

func TestApp_FindByID(t *testing.T) {
	db := openTestDBNoApp(t)
	repo := NewAppRepo(db)

	_, err := repo.Create(bg, App{ID: "app1", Name: "Test", Path: "/tmp/app1"})
	require.NoError(t, err)

	app, err := repo.FindByID(bg, "app1")
	require.NoError(t, err)
	assert.Equal(t, "app1", app.ID)
	assert.Equal(t, "Test", app.Name)
}

func TestApp_FindByID_NotFound(t *testing.T) {
	db := openTestDBNoApp(t)
	repo := NewAppRepo(db)

	_, err := repo.FindByID(bg, "nonexistent")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestApp_UpdateStatus(t *testing.T) {
	db := openTestDBNoApp(t)
	repo := NewAppRepo(db)

	_, err := repo.Create(bg, App{ID: "app1", Name: "Test", Path: "/tmp/app1"})
	require.NoError(t, err)

	err = repo.UpdateStatus(bg, "app1", "created")
	require.NoError(t, err)

	app, err := repo.FindByID(bg, "app1")
	require.NoError(t, err)
	assert.Equal(t, "created", app.Status)
}

func TestApp_UpdateStatus_NotFound(t *testing.T) {
	db := openTestDBNoApp(t)
	repo := NewAppRepo(db)

	err := repo.UpdateStatus(bg, "nonexistent", "created")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestApp_MarkInitialBuildComplete(t *testing.T) {
	db := openTestDBNoApp(t)
	repo := NewAppRepo(db)

	_, err := repo.Create(bg, App{ID: "app1", Name: "Test", Path: "/tmp/app1"})
	require.NoError(t, err)

	err = repo.MarkInitialBuildComplete(bg, "app1")
	require.NoError(t, err)

	app, err := repo.FindByID(bg, "app1")
	require.NoError(t, err)
	assert.True(t, app.InitialBuildComplete)
}

func TestApp_MarkInitialBuildComplete_NotFound(t *testing.T) {
	db := openTestDBNoApp(t)
	repo := NewAppRepo(db)

	err := repo.MarkInitialBuildComplete(bg, "nonexistent")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestApp_Delete(t *testing.T) {
	db := openTestDBNoApp(t)
	repo := NewAppRepo(db)

	_, err := repo.Create(bg, App{ID: "app1", Name: "Test", Path: "/tmp/app1"})
	require.NoError(t, err)

	err = repo.Delete(bg, "app1")
	require.NoError(t, err)

	_, err = repo.FindByID(bg, "app1")
	require.Error(t, err)
}

func TestApp_Delete_NotFound(t *testing.T) {
	db := openTestDBNoApp(t)
	repo := NewAppRepo(db)

	err := repo.Delete(bg, "nonexistent")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestApp_Delete_CascadesConversations(t *testing.T) {
	db := openTestDBNoApp(t)
	appRepo := NewAppRepo(db)
	convRepo := NewConversationRepo(db)

	_, err := appRepo.Create(bg, App{ID: "app1", Name: "Test", Path: "/tmp/app1"})
	require.NoError(t, err)
	_, err = convRepo.Create(bg, "conv1", "app1", "develop", nil)
	require.NoError(t, err)

	err = appRepo.Delete(bg, "app1")
	require.NoError(t, err)

	_, err = convRepo.GetByID(bg, "conv1")
	require.Error(t, err)
}

func TestOpen_SchemaIsIdempotent(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")

	// Open twice — schema should be applied idempotently.
	db1, err := Open(dbPath)
	require.NoError(t, err)
	db1.Close()

	db2, err := Open(dbPath)
	require.NoError(t, err)
	db2.Close()
}

func TestOpen_PragmasApplied(t *testing.T) {
	db := openTestDBNoApp(t)

	var journalMode string
	err := db.QueryRow("PRAGMA journal_mode").Scan(&journalMode)
	require.NoError(t, err)
	assert.Equal(t, "wal", journalMode)

	var foreignKeys int
	err = db.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys)
	require.NoError(t, err)
	assert.Equal(t, 1, foreignKeys)

	var busyTimeout int
	err = db.QueryRow("PRAGMA busy_timeout").Scan(&busyTimeout)
	require.NoError(t, err)
	assert.Equal(t, 5000, busyTimeout)
}

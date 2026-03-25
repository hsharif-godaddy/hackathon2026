package session

import (
	"context"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/eventbus"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/prompt"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/store"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// --- Fake LLM ---

type fakeLLM struct {
	mu       sync.Mutex
	response string
	delay    time.Duration
}

func (f *fakeLLM) StreamMessage(
	ctx context.Context,
	_ string,
	_ string,
	_ []run.Message,
	_ []tool.Tool,
	onEvent func(run.StreamEvent),
) (string, []run.ToolCall, *run.Usage, error) {
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return "", nil, nil, ctx.Err()
		}
	}

	f.mu.Lock()
	resp := f.response
	f.mu.Unlock()

	onEvent(run.StreamEvent{Type: "token", Text: resp})
	return resp, nil, &run.Usage{InputTokens: 10, OutputTokens: 5}, nil
}

var _ run.LLMClient = (*fakeLLM)(nil)

// --- Test Helpers ---

func setupTestManager(
	t *testing.T,
	llm run.LLMClient,
) (*Manager, *store.ConversationRepo, *store.MessageRepo) {
	t.Helper()

	db, err := store.Open(t.TempDir() + "/test.db")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	convRepo := store.NewConversationRepo(db)
	msgRepo := store.NewMessageRepo(db)

	// Create a test app so FK constraints on conversations pass.
	appRepo := store.NewAppRepo(db)
	_, err = appRepo.Create(context.Background(), store.App{
		ID:   "app1",
		Name: "Test App",
		Path: "/tmp/test",
	})
	require.NoError(t, err)
	// Second app for ownership tests.
	_, err = appRepo.Create(context.Background(), store.App{
		ID:   "app2",
		Name: "Other App",
		Path: "/tmp/other",
	})
	require.NoError(t, err)

	bus := eventbus.New()
	runStore := run.NewStore()
	registry := tool.NewRegistry()
	loader := prompt.NewLoader(fstest.MapFS{
		"base.md": &fstest.MapFile{Data: []byte("You are helpful.")},
	})
	configs := map[string]run.AgentConfig{
		"develop": {
			ID: "develop",
			PromptConfig: prompt.Config{
				BasePrompt: "base.md",
			},
			Model: "test-model",
		},
	}
	engine := run.NewEngine(bus, runStore, registry, loader, configs)

	mgr := NewManager(engine, runStore, convRepo, msgRepo, llm)
	return mgr, convRepo, msgRepo
}

// waitForRunStatus polls the run store until the run reaches the expected
// status or 2 seconds elapse.
func waitForRunStatus(
	t *testing.T,
	runStore *run.Store,
	runID string,
	want run.Status,
) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		r, err := runStore.Get(runID)
		require.NoError(t, err)
		if r.Status == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timeout waiting for run %s to reach status %s (current: %s)", runID, want, r.Status)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// --- Tests ---

func TestHandleConnect_Fresh(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{response: "hi"})

	resp, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})

	require.NoError(t, err)
	assert.Empty(t, resp.ConversationID)
	assert.Empty(t, resp.RunID)
	assert.Nil(t, resp.ReplayFrom)
}

func TestHandleConnect_WithConversationID(t *testing.T) {
	mgr, convRepo, _ := setupTestManager(t, &fakeLLM{response: "hi"})

	_, err := convRepo.Create(context.Background(), "conv1", "app1", "develop", nil)
	require.NoError(t, err)

	resp, err := mgr.HandleConnect("conn1", ConnectData{
		AppID:          "app1",
		ConversationID: "conv1",
	})

	require.NoError(t, err)
	assert.Equal(t, "conv1", resp.ConversationID)
	assert.Empty(t, resp.RunID)
}

func TestHandleConnect_WithConversationAndActiveRun(t *testing.T) {
	mgr, convRepo, _ := setupTestManager(t, &fakeLLM{
		response: "done",
		delay:    2 * time.Second,
	})

	_, err := convRepo.Create(context.Background(), "conv1", "app1", "develop", nil)
	require.NoError(t, err)

	_, err = mgr.HandleConnect("conn1", ConnectData{
		AppID:          "app1",
		ConversationID: "conv1",
	})
	require.NoError(t, err)

	runID, err := mgr.HandleMessage("conn1", "hello")
	require.NoError(t, err)

	// Wait for run to start.
	waitForRunStatus(t, mgr.runStore, runID, run.StatusRunning)

	// Reconnect — should see active run.
	lastSeq := int64(0)
	resp, err := mgr.HandleConnect("conn2", ConnectData{
		AppID:          "app1",
		ConversationID: "conv1",
		LastSequence:   &lastSeq,
	})

	require.NoError(t, err)
	assert.Equal(t, "conv1", resp.ConversationID)
	assert.Equal(t, runID, resp.RunID)
	assert.NotEmpty(t, resp.RunStatus)
	assert.NotNil(t, resp.ReplayFrom)

	_ = mgr.HandleCancel("conn2")
}

func TestHandleConnect_AppIDOnly_FindsLatest(t *testing.T) {
	mgr, convRepo, _ := setupTestManager(t, &fakeLLM{response: "hi"})

	_, err := convRepo.Create(context.Background(), "conv1", "app1", "develop", nil)
	require.NoError(t, err)
	_, err = convRepo.Create(context.Background(), "conv2", "app1", "develop", nil)
	require.NoError(t, err)

	resp, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})

	require.NoError(t, err)
	assert.Equal(t, "conv2", resp.ConversationID)
}

func TestHandleConnect_ConversationOwnership(t *testing.T) {
	mgr, convRepo, _ := setupTestManager(t, &fakeLLM{response: "hi"})

	// Create conversation owned by app2.
	_, err := convRepo.Create(context.Background(), "conv1", "app2", "develop", nil)
	require.NoError(t, err)

	// Try to connect with app1 — should fail.
	_, err = mgr.HandleConnect("conn1", ConnectData{
		AppID:          "app1",
		ConversationID: "conv1",
	})

	require.Error(t, err)
	assert.ErrorIs(t, err, ErrConversationNotOwn)
}

func TestHandleConnect_ConversationNotFound(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{response: "hi"})

	_, err := mgr.HandleConnect("conn1", ConnectData{
		AppID:          "app1",
		ConversationID: "nonexistent",
	})

	require.Error(t, err)
	assert.ErrorIs(t, err, store.ErrNotFound)
}

func TestHandleMessage_CreatesConversation(t *testing.T) {
	mgr, convRepo, _ := setupTestManager(t, &fakeLLM{response: "response"})

	_, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})
	require.NoError(t, err)

	runID, err := mgr.HandleMessage("conn1", "hello world")
	require.NoError(t, err)
	assert.NotEmpty(t, runID)

	sess, err := mgr.GetSession("conn1")
	require.NoError(t, err)
	assert.NotEmpty(t, sess.ConversationID)

	convs, err := convRepo.GetByAppID(context.Background(), "app1")
	require.NoError(t, err)
	assert.Len(t, convs, 1)
}

func TestHandleMessage_PersistsUserMessage(t *testing.T) {
	mgr, _, msgRepo := setupTestManager(t, &fakeLLM{response: "response"})

	_, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})
	require.NoError(t, err)

	_, err = mgr.HandleMessage("conn1", "test message")
	require.NoError(t, err)

	sess, err := mgr.GetSession("conn1")
	require.NoError(t, err)

	msgs, err := msgRepo.GetByConversationID(context.Background(), sess.ConversationID)
	require.NoError(t, err)
	require.Len(t, msgs, 1)
	assert.Equal(t, "user", msgs[0].Sender)
	assert.Equal(t, "test message", msgs[0].Content)
}

func TestHandleMessage_SetsCreatedAt(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{response: "response"})

	_, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})
	require.NoError(t, err)

	before := time.Now()
	runID, err := mgr.HandleMessage("conn1", "hi")
	require.NoError(t, err)

	r, err := mgr.runStore.Get(runID)
	require.NoError(t, err)
	assert.False(t, r.CreatedAt.IsZero())
	assert.True(t, r.CreatedAt.After(before) || r.CreatedAt.Equal(before))
}

func TestHandleMessage_SessionNotFound(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{response: "hi"})

	_, err := mgr.HandleMessage("nonexistent", "hello")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrSessionNotFound)
}

func TestHandleCancel(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{
		response: "done",
		delay:    5 * time.Second,
	})

	_, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})
	require.NoError(t, err)

	runID, err := mgr.HandleMessage("conn1", "long task")
	require.NoError(t, err)

	waitForRunStatus(t, mgr.runStore, runID, run.StatusRunning)

	err = mgr.HandleCancel("conn1")
	require.NoError(t, err)

	waitForRunStatus(t, mgr.runStore, runID, run.StatusCancelled)
}

func TestHandleCancel_NoActiveRun(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{response: "hi"})

	_, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})
	require.NoError(t, err)

	err = mgr.HandleCancel("conn1")
	assert.ErrorIs(t, err, ErrNoActiveRun)
}

func TestHandleCancel_SessionNotFound(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{response: "hi"})

	err := mgr.HandleCancel("nonexistent")
	assert.ErrorIs(t, err, ErrSessionNotFound)
}

func TestHandleDisconnect(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{response: "hi"})

	_, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})
	require.NoError(t, err)

	mgr.HandleDisconnect("conn1")

	_, err = mgr.GetSession("conn1")
	assert.ErrorIs(t, err, ErrSessionNotFound)
}

func TestHandleDisconnect_RunContinues(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{
		response: "done",
		delay:    200 * time.Millisecond,
	})

	_, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})
	require.NoError(t, err)

	runID, err := mgr.HandleMessage("conn1", "work on this")
	require.NoError(t, err)

	waitForRunStatus(t, mgr.runStore, runID, run.StatusRunning)

	mgr.HandleDisconnect("conn1")

	waitForRunStatus(t, mgr.runStore, runID, run.StatusCompleted)
}

func TestHandleMessage_CancelsPreviousRun(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{
		response: "done",
		delay:    5 * time.Second,
	})

	_, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})
	require.NoError(t, err)

	runID1, err := mgr.HandleMessage("conn1", "first message")
	require.NoError(t, err)

	waitForRunStatus(t, mgr.runStore, runID1, run.StatusRunning)

	// Second message should cancel the first run.
	runID2, err := mgr.HandleMessage("conn1", "second message")
	require.NoError(t, err)
	assert.NotEqual(t, runID1, runID2)

	// First run should be cancelled.
	waitForRunStatus(t, mgr.runStore, runID1, run.StatusCancelled)

	// Second run should be running.
	waitForRunStatus(t, mgr.runStore, runID2, run.StatusRunning)

	// Clean up.
	_ = mgr.HandleCancel("conn1")
}

func TestGetSession_ReturnsCopy(t *testing.T) {
	mgr, _, _ := setupTestManager(t, &fakeLLM{response: "hi"})

	_, err := mgr.HandleConnect("conn1", ConnectData{AppID: "app1"})
	require.NoError(t, err)

	sess, err := mgr.GetSession("conn1")
	require.NoError(t, err)

	sess.AppID = "changed"

	sess2, err := mgr.GetSession("conn1")
	require.NoError(t, err)
	assert.Equal(t, "app1", sess2.AppID)
}

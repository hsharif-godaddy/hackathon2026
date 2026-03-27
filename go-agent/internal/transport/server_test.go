package transport

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/eventbus"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/prompt"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/session"
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

type testEnv struct {
	ts    *httptest.Server
	mgr   *session.Manager
	store *run.Store
}

func setupTestServer(t *testing.T, llm run.LLMClient, auth AuthFunc) *testEnv {
	t.Helper()

	db, err := store.Open(t.TempDir() + "/test.db")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	convRepo := store.NewConversationRepo(db)
	msgRepo := store.NewMessageRepo(db)

	appRepo := store.NewAppRepo(db)
	_, err = appRepo.Create(context.Background(), store.App{
		ID:   "app1",
		Name: "Test App",
		Path: "/tmp/test",
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
			ID:           "develop",
			PromptConfig: prompt.Config{BasePrompt: "base.md"},
			Model:        "test-model",
		},
	}
	engine := run.NewEngine(bus, runStore, registry, loader, configs)
	mgr := session.NewManager(engine, runStore, convRepo, msgRepo, llm)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := NewServer(mgr, runStore, auth, logger)

	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	return &testEnv{ts: ts, mgr: mgr, store: runStore}
}

func allowAll(_ *http.Request) (string, error) {
	return "app1", nil
}

func dial(t *testing.T, env *testEnv) *websocket.Conn {
	t.Helper()
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, "ws"+env.ts.URL[4:], nil)
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close(websocket.StatusNormalClosure, "") })
	return conn
}

func sendMsg(t *testing.T, conn *websocket.Conn, msg ClientMessage) {
	t.Helper()
	data, err := json.Marshal(msg)
	require.NoError(t, err)
	err = conn.Write(context.Background(), websocket.MessageText, data)
	require.NoError(t, err)
}

func readMsg(t *testing.T, conn *websocket.Conn) ServerMessage {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	require.NoError(t, err)
	var msg ServerMessage
	require.NoError(t, json.Unmarshal(data, &msg))
	return msg
}

func readMsgOfType(t *testing.T, conn *websocket.Conn, msgType string) ServerMessage {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatalf("timeout waiting for message type %q", msgType)
		}
		msg := readMsg(t, conn)
		if msg.Type == msgType {
			return msg
		}
	}
}

// --- Tests ---

func TestWebSocket_ServerConfig(t *testing.T) {
	env := setupTestServer(t, &fakeLLM{response: "hi"}, allowAll)
	conn := dial(t, env)

	// First message should be server_config.
	msg := readMsg(t, conn)
	assert.Equal(t, MsgTypeServerConfig, msg.Type)
}

func TestWebSocket_ConnectAndConnected(t *testing.T) {
	env := setupTestServer(t, &fakeLLM{response: "hi"}, allowAll)
	conn := dial(t, env)

	// Skip server_config.
	_ = readMsg(t, conn)

	sendMsg(t, conn, ClientMessage{
		Type: MsgTypeConnect,
	})

	msg := readMsg(t, conn)
	assert.Equal(t, MsgTypeConnected, msg.Type)
}

func TestWebSocket_PingPong(t *testing.T) {
	env := setupTestServer(t, &fakeLLM{response: "hi"}, allowAll)
	conn := dial(t, env)

	_ = readMsg(t, conn) // server_config

	sendMsg(t, conn, ClientMessage{Type: MsgTypePing})

	msg := readMsg(t, conn)
	assert.Equal(t, MsgTypePong, msg.Type)
}

func TestWebSocket_ChatReceivesTokensAndComplete(t *testing.T) {
	env := setupTestServer(t, &fakeLLM{response: "Hello!"}, allowAll)
	conn := dial(t, env)

	_ = readMsg(t, conn) // server_config

	// Connect first.
	sendMsg(t, conn, ClientMessage{Type: MsgTypeConnect})
	_ = readMsg(t, conn) // connected

	// Send chat message.
	chatData, _ := json.Marshal(ChatData{Message: "Hi"})
	sendMsg(t, conn, ClientMessage{
		Type: MsgTypeChat,
		Data: chatData,
	})

	// Should receive chunk(s) and complete.
	chunk := readMsgOfType(t, conn, MsgTypeChunk)
	assert.NotEmpty(t, chunk.Content)

	complete := readMsgOfType(t, conn, MsgTypeComplete)
	assert.Equal(t, MsgTypeComplete, complete.Type)
}

func TestWebSocket_Cancel(t *testing.T) {
	env := setupTestServer(t, &fakeLLM{
		response: "done",
		delay:    5 * time.Second,
	}, allowAll)
	conn := dial(t, env)

	_ = readMsg(t, conn) // server_config

	sendMsg(t, conn, ClientMessage{Type: MsgTypeConnect})
	_ = readMsg(t, conn) // connected

	chatData, _ := json.Marshal(ChatData{Message: "Long task"})
	sendMsg(t, conn, ClientMessage{
		Type: MsgTypeChat,
		Data: chatData,
	})

	// Cancel immediately — the run is registered in the session manager
	// synchronously by HandleMessage before the goroutine starts.
	sendMsg(t, conn, ClientMessage{Type: MsgTypeCancel})

	// Should receive a complete message with cancelled flag.
	complete := readMsgOfType(t, conn, MsgTypeComplete)
	data, ok := complete.Data.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, true, data["cancelled"])
}

func TestWebSocket_InvalidMessageType(t *testing.T) {
	env := setupTestServer(t, &fakeLLM{response: "hi"}, allowAll)
	conn := dial(t, env)

	_ = readMsg(t, conn) // server_config

	sendMsg(t, conn, ClientMessage{Type: "invalid_type"})

	msg := readMsg(t, conn)
	assert.Equal(t, MsgTypeError, msg.Type)
	assert.Contains(t, msg.Content, "unknown message type")
}

func TestWebSocket_AuthRejection(t *testing.T) {
	rejectAll := func(_ *http.Request) (string, error) {
		return "", http.ErrNoCookie // any error rejects
	}

	env := setupTestServer(t, &fakeLLM{response: "hi"}, rejectAll)

	// Attempt to connect — should get 401.
	ctx := context.Background()
	_, resp, err := websocket.Dial(ctx, "ws"+env.ts.URL[4:], nil)
	require.Error(t, err)
	if resp != nil {
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	}
}

func TestTranslateEvent_Token(t *testing.T) {
	ev := run.Event{Data: run.TokenData{Text: "hello"}}
	msg := translateEvent(ev)
	require.NotNil(t, msg)
	assert.Equal(t, MsgTypeChunk, msg.Type)
	assert.Equal(t, "hello", msg.Content)
}

func TestTranslateEvent_ToolStart(t *testing.T) {
	ev := run.Event{Data: run.ToolStartData{Name: "readFile", ID: "c1"}}
	msg := translateEvent(ev)
	require.NotNil(t, msg)
	assert.Equal(t, MsgTypeToolStart, msg.Type)
}

func TestTranslateEvent_Completed(t *testing.T) {
	ev := run.Event{Data: run.CompletedData{Iterations: 2, ToolsCalled: 3}}
	msg := translateEvent(ev)
	require.NotNil(t, msg)
	assert.Equal(t, MsgTypeComplete, msg.Type)
}

func TestTranslateEvent_InternalEventsAreNil(t *testing.T) {
	ev := run.Event{Data: run.PromptBuiltData{TokenCount: 100}}
	msg := translateEvent(ev)
	assert.Nil(t, msg)
}

func TestTranslateEvent_Failed(t *testing.T) {
	ev := run.Event{Data: run.FailedData{Error: "boom"}}
	msg := translateEvent(ev)
	require.NotNil(t, msg)
	assert.Equal(t, MsgTypeError, msg.Type)
	assert.Equal(t, "boom", msg.Content)
}

func TestWebSocket_ReconnectReplay(t *testing.T) {
	env := setupTestServer(t, &fakeLLM{
		response: "working",
		delay:    2 * time.Second,
	}, allowAll)

	// First connection: use session manager directly to start a run.
	conn1 := dial(t, env)
	_ = readMsg(t, conn1) // server_config

	_, err := env.mgr.HandleConnect("direct-conn", session.ConnectData{AppID: "app1"})
	require.NoError(t, err)
	runID, err := env.mgr.HandleMessage("direct-conn", "Do work")
	require.NoError(t, err)

	// Wait for the run to produce events in the store.
	deadline := time.Now().Add(2 * time.Second)
	var convID string
	for {
		r, getErr := env.store.Get(runID)
		require.NoError(t, getErr)
		if r.Status == run.StatusRunning {
			convID = r.ConversationID
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("timeout waiting for run to start")
		}
		time.Sleep(5 * time.Millisecond)
	}
	require.NotEmpty(t, convID)

	// Reconnect via WebSocket with conversationID — triggers replay path.
	connectData, _ := json.Marshal(session.ConnectData{
		ConversationID: convID,
	})
	sendMsg(t, conn1, ClientMessage{
		Type: MsgTypeConnect,
		Data: connectData,
	})

	connectedMsg := readMsg(t, conn1)
	assert.Equal(t, MsgTypeConnected, connectedMsg.Type)

	// The connected response should have a RunID and ReplayFrom.
	dataMap, ok := connectedMsg.Data.(map[string]any)
	require.True(t, ok)
	assert.NotEmpty(t, dataMap["runId"])
	assert.NotNil(t, dataMap["replayFrom"])

	// Should receive replayed chunk events from the active run.
	msg := readMsgOfType(t, conn1, MsgTypeChunk)
	assert.NotEmpty(t, msg.Content)

	// Clean up.
	_ = env.mgr.HandleCancel("direct-conn")
}

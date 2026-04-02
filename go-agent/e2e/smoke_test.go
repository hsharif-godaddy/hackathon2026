package e2e

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
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/transport"
)

// --- Fake LLM that simulates a tool call followed by a text response ---

type fakeLLM struct {
	mu   sync.Mutex
	call int
}

func (f *fakeLLM) StreamMessage(
	_ context.Context,
	_ string,
	_ string,
	_ []run.Message,
	_ []tool.Tool,
	onEvent func(run.StreamEvent),
) (string, []run.ToolCall, *run.Usage, error) {
	f.mu.Lock()
	call := f.call
	f.call++
	f.mu.Unlock()

	if call == 0 {
		// First call: return a tool call.
		onEvent(run.StreamEvent{Type: "token", Text: "Let me check "})
		onEvent(run.StreamEvent{Type: "token", Text: "the directory."})
		return "Let me check the directory.", []run.ToolCall{
			{
				ID:    "call_1",
				Name:  "directoryListing",
				Input: json.RawMessage(`{}`),
			},
		}, &run.Usage{InputTokens: 100, OutputTokens: 20}, nil
	}

	// Second call: text-only response after tool result.
	onEvent(run.StreamEvent{Type: "token", Text: "Here are "})
	onEvent(run.StreamEvent{Type: "token", Text: "the files."})
	return "Here are the files.", nil,
		&run.Usage{InputTokens: 150, OutputTokens: 30}, nil
}

var _ run.LLMClient = (*fakeLLM)(nil)

// --- Fake tool ---

type fakeDirListing struct{}

func (t *fakeDirListing) Name() string                 { return "directoryListing" }
func (t *fakeDirListing) Description() string          { return "List files" }
func (t *fakeDirListing) InputSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (t *fakeDirListing) Execute(
	_ context.Context,
	_ json.RawMessage,
	out tool.OutputStream,
) error {
	out.Write("file1.txt\nfile2.txt\n")
	return nil
}

// --- E2E Smoke Test ---

func TestSmoke_FullAgentLoop(t *testing.T) {
	// 1. Set up all components (matching main.go wiring).
	db, err := store.Open(t.TempDir() + "/e2e.db")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	appRepo := store.NewAppRepo(db)
	_, err = appRepo.Create(context.Background(), store.App{
		ID:   "e2e-app",
		Name: "E2E Test App",
		Path: "/tmp/e2e",
	})
	require.NoError(t, err)

	bus := eventbus.New()
	t.Cleanup(bus.Close)

	runStore := run.NewStore()

	registry := tool.NewRegistry()
	registry.Register(&fakeDirListing{})

	promptLoader := prompt.NewLoader(fstest.MapFS{
		"develop/core.md": &fstest.MapFile{Data: []byte("You are a helpful developer.")},
	})

	configs := map[string]run.AgentConfig{
		"develop": {
			ID: "develop",
			PromptConfig: prompt.Config{
				BasePrompt: "develop/core.md",
			},
			Tools: []string{"directoryListing"},
			Model: "test-model",
		},
	}

	engine := run.NewEngine(bus, runStore, registry, promptLoader, configs)

	convRepo := store.NewConversationRepo(db)
	msgRepo := store.NewMessageRepo(db)
	llm := &fakeLLM{}
	sessMgr := session.NewManager(engine, runStore, convRepo, msgRepo, llm)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	authFunc := func(_ *http.Request) (string, error) {
		return "e2e-app", nil
	}
	ws := transport.NewServer(sessMgr, runStore, authFunc, logger)

	mux := http.NewServeMux()
	mux.Handle("/ws", ws.Handler())

	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	// 2. Connect via WebSocket.
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, "ws"+ts.URL[4:]+"/ws", nil)
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close(websocket.StatusNormalClosure, "") })

	// Read server_config.
	msg := readMsg(t, conn)
	assert.Equal(t, "server_config", msg["type"])

	// 3. Send connect message.
	sendJSON(t, conn, map[string]any{"type": "connect"})
	msg = readMsg(t, conn)
	assert.Equal(t, "connected", msg["type"])

	// 4. Send chat message.
	sendJSON(t, conn, map[string]any{
		"type": "chat",
		"data": map[string]any{"message": "List the files"},
	})

	// 5. Collect all messages until run completes.
	var messages []map[string]any
	deadline := time.Now().Add(10 * time.Second)
	for {
		m := readMsg(t, conn)
		messages = append(messages, m)

		msgType, _ := m["type"].(string)
		if msgType == "complete" || msgType == "error" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("timeout waiting for run to complete")
		}
	}

	// Verify we received the expected event types.
	types := make([]string, len(messages))
	for i, m := range messages {
		types[i], _ = m["type"].(string)
	}

	assert.Contains(t, types, "chunk", "should have token chunks")
	assert.Contains(t, types, "tool_start", "should have tool_start")
	assert.Contains(t, types, "tool_result", "should have tool_result")
	assert.Contains(t, types, "complete", "should have complete")

	// Verify the complete message has expected data.
	var completeMsg map[string]any
	for _, m := range messages {
		if m["type"] == "complete" {
			completeMsg = m
			break
		}
	}
	require.NotNil(t, completeMsg)
	data, ok := completeMsg["data"].(map[string]any)
	require.True(t, ok)
	iterations, _ := data["iterations"].(float64)
	toolsCalled, _ := data["toolsCalled"].(float64)
	assert.Equal(t, 2, int(iterations))
	assert.Equal(t, 1, int(toolsCalled))

	// 6. Verify conversation and messages were persisted to SQLite.
	convs, err := convRepo.GetByAppID(context.Background(), "e2e-app")
	require.NoError(t, err)
	require.Len(t, convs, 1, "should have created one conversation")

	msgs, err := msgRepo.GetByConversationID(context.Background(), convs[0].ID)
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(msgs), 1, "should have persisted the user message")
	assert.Equal(t, "user", msgs[0].Sender)
	assert.Equal(t, "List the files", msgs[0].Content)
}

// --- Helpers ---

func sendJSON(t *testing.T, conn *websocket.Conn, v any) {
	t.Helper()
	data, err := json.Marshal(v)
	require.NoError(t, err)
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, data))
}

func readMsg(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	require.NoError(t, err)
	var msg map[string]any
	require.NoError(t, json.Unmarshal(data, &msg))
	return msg
}

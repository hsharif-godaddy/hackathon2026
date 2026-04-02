package toolbridge

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// startUnixServer creates an HTTP server listening on a Unix socket in t.TempDir().
// It returns the http.Client configured to connect via that socket and a cleanup function.
func startUnixServer(t *testing.T, handler http.Handler) *http.Client {
	t.Helper()

	sockPath := filepath.Join(t.TempDir(), "bridge.sock")
	ln, err := net.Listen("unix", sockPath)
	require.NoError(t, err)

	srv := &http.Server{Handler: handler}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	return newHTTPClient(sockPath)
}

func TestBridgeTool_Execute_Success(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /tools/legacyTool", func(w http.ResponseWriter, r *http.Request) {
		var req bridgeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Verify the input is preserved correctly.
		assert.JSONEq(t, `{"key":"value"}`, string(req.Input))

		// Verify context fields are forwarded.
		if assert.NotNil(t, req.Context) {
			assert.Equal(t, "app-123", req.Context.AppID)
			assert.Equal(t, "sess-1", req.Context.SessionID)
			assert.Equal(t, "conv-1", req.Context.ConversationID)
			assert.Equal(t, "user-1", req.Context.UserID)
		}

		w.Header().Set("Content-Type", "application/x-ndjson")
		fmt.Fprintln(w, `{"chunk":"Hello "}`)
		fmt.Fprintln(w, `{"chunk":"World"}`)
	})

	client := startUnixServer(t, mux)

	bt := &BridgeTool{
		name:   "legacyTool",
		schema: json.RawMessage(`{}`),
		client: client,
	}

	ctx := tool.WithScope(context.Background(), tool.RequestScope{
		AppID:          "app-123",
		SessionID:      "sess-1",
		ConversationID: "conv-1",
		UserID:         "user-1",
	})

	out := &tool.BufferedStream{}
	err := bt.Execute(ctx, json.RawMessage(`{"key":"value"}`), out)

	require.NoError(t, err)
	assert.Equal(t, "Hello World", out.String())
}

func TestBridgeTool_Execute_NoScope(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /tools/noScopeTool", func(w http.ResponseWriter, r *http.Request) {
		var req bridgeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Input should be present.
		assert.JSONEq(t, `{"key":"value"}`, string(req.Input))
		// Context should be absent when no scope is set.
		assert.Nil(t, req.Context)

		w.Header().Set("Content-Type", "application/x-ndjson")
		fmt.Fprintln(w, `{"chunk":"ok"}`)
	})

	client := startUnixServer(t, mux)

	bt := &BridgeTool{
		name:   "noScopeTool",
		schema: json.RawMessage(`{}`),
		client: client,
	}

	out := &tool.BufferedStream{}
	err := bt.Execute(context.Background(), json.RawMessage(`{"key":"value"}`), out)

	require.NoError(t, err)
	assert.Equal(t, "ok", out.String())
}

func TestBridgeTool_Execute_StreamingChunks(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /tools/streamTool", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		for i := range 5 {
			fmt.Fprintf(w, `{"chunk":"chunk%d"}`, i)
			fmt.Fprintln(w)
		}
	})

	client := startUnixServer(t, mux)

	bt := &BridgeTool{
		name:   "streamTool",
		schema: json.RawMessage(`{}`),
		client: client,
	}

	out := &tool.BufferedStream{}
	err := bt.Execute(context.Background(), json.RawMessage(`{}`), out)

	require.NoError(t, err)
	assert.Equal(t, "chunk0chunk1chunk2chunk3chunk4", out.String())
}

func TestBridgeTool_Execute_ToolError(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /tools/failTool", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		fmt.Fprintln(w, `{"chunk":"partial output"}`)
		fmt.Fprintln(w, `{"error":"something went wrong"}`)
	})

	client := startUnixServer(t, mux)

	bt := &BridgeTool{
		name:   "failTool",
		schema: json.RawMessage(`{}`),
		client: client,
	}

	out := &tool.BufferedStream{}
	err := bt.Execute(context.Background(), json.RawMessage(`{}`), out)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "something went wrong")
	// Partial output should have been written before the error.
	assert.Equal(t, "partial output", out.String())
	// Error should be written to the error stream.
	assert.Equal(t, "something went wrong", out.ErrorString())
}

func TestBridgeTool_Execute_HTTPError(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /tools/badTool", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	client := startUnixServer(t, mux)

	bt := &BridgeTool{
		name:   "badTool",
		schema: json.RawMessage(`{}`),
		client: client,
	}

	out := &tool.BufferedStream{}
	err := bt.Execute(context.Background(), json.RawMessage(`{}`), out)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "status 500")
}

func TestBridgeTool_Execute_BridgeUnavailable(t *testing.T) {
	// Point at a socket that doesn't exist.
	client := newHTTPClient(filepath.Join(t.TempDir(), "nonexistent.sock"))

	bt := &BridgeTool{
		name:   "anyTool",
		schema: json.RawMessage(`{}`),
		client: client,
	}

	out := &tool.BufferedStream{}
	err := bt.Execute(context.Background(), json.RawMessage(`{}`), out)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "bridge request failed")
}

func TestBridgeTool_Execute_ContextCancellation(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /tools/slowTool", func(_ http.ResponseWriter, r *http.Request) {
		// Block until the request context is cancelled.
		<-r.Context().Done()
	})

	client := startUnixServer(t, mux)

	bt := &BridgeTool{
		name:   "slowTool",
		schema: json.RawMessage(`{}`),
		client: client,
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately.

	out := &tool.BufferedStream{}
	err := bt.Execute(ctx, json.RawMessage(`{}`), out)

	require.Error(t, err)
}

func TestBridgeTool_Execute_EmptyLines(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /tools/spaceyTool", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		fmt.Fprintln(w, `{"chunk":"a"}`)
		fmt.Fprintln(w) // empty line
		fmt.Fprintln(w, `{"chunk":"b"}`)
	})

	client := startUnixServer(t, mux)

	bt := &BridgeTool{
		name:   "spaceyTool",
		schema: json.RawMessage(`{}`),
		client: client,
	}

	out := &tool.BufferedStream{}
	err := bt.Execute(context.Background(), json.RawMessage(`{}`), out)

	require.NoError(t, err)
	assert.Equal(t, "ab", out.String())
}

func TestBridgeTool_Execute_InvalidNDJSON(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /tools/badJSON", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		fmt.Fprintln(w, `{"chunk":"ok"}`)
		fmt.Fprintln(w, `not valid json`)
	})

	client := startUnixServer(t, mux)

	bt := &BridgeTool{
		name:   "badJSON",
		schema: json.RawMessage(`{}`),
		client: client,
	}

	out := &tool.BufferedStream{}
	err := bt.Execute(context.Background(), json.RawMessage(`{}`), out)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "decoding bridge response line")
	// First chunk should have been written before the bad line.
	assert.Equal(t, "ok", out.String())
}

func TestBridgeTool_Accessors(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"path":{"type":"string"}}}`)
	bt := &BridgeTool{
		name:        "testTool",
		description: "A test tool",
		schema:      schema,
	}

	assert.Equal(t, "testTool", bt.Name())
	assert.Equal(t, "A test tool", bt.Description())
	assert.JSONEq(t, string(schema), string(bt.InputSchema()))
}

func TestDiscoverTools_Success(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /tools", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"name":"readFile","description":"Read a file","input_schema":{"type":"object"}},
			{"name":"writeFile","description":"Write a file","input_schema":{"type":"object"}}
		]`))
	})

	client := startUnixServer(t, mux)

	tools, err := DiscoverToolsWithClient(context.Background(), client)

	require.NoError(t, err)
	require.Len(t, tools, 2)

	assert.Equal(t, "readFile", tools[0].Name())
	assert.Equal(t, "Read a file", tools[0].Description())

	assert.Equal(t, "writeFile", tools[1].Name())
	assert.Equal(t, "Write a file", tools[1].Description())
}

func TestDiscoverTools_BridgeUnavailable(t *testing.T) {
	client := newHTTPClient(filepath.Join(t.TempDir(), "nonexistent.sock"))

	_, err := DiscoverToolsWithClient(context.Background(), client)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "discovering bridge tools")
}

func TestDiscoverTools_BadResponse(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /tools", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})

	client := startUnixServer(t, mux)

	_, err := DiscoverToolsWithClient(context.Background(), client)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "status 503")
}

func TestDiscoverTools_InvalidJSON(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /tools", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`not json`))
	})

	client := startUnixServer(t, mux)

	_, err := DiscoverToolsWithClient(context.Background(), client)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "decoding bridge tool list")
}

// Verify BridgeTool satisfies tool.Tool at compile time.
var _ tool.Tool = (*BridgeTool)(nil)

package toolbridge

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// BridgeTool implements tool.Tool by forwarding calls to the TypeScript bridge
// over a Unix-domain socket. Each BridgeTool wraps one legacy TypeScript tool.
//
// Protocol:
//
//	POST /tools/{name} with JSON body  →  NDJSON response
//	Each line: {"chunk":"..."} or {"error":"..."}
type BridgeTool struct {
	name        string
	description string
	schema      json.RawMessage
	client      *http.Client
}

// ndjsonLine represents a single line of the NDJSON response from the TS bridge.
type ndjsonLine struct {
	Chunk string `json:"chunk,omitempty"`
	Error string `json:"error,omitempty"`
}

// bridgeRequest is the envelope sent to the TS bridge, wrapping the tool input
// with optional context metadata.
type bridgeRequest struct {
	Input   json.RawMessage `json:"input"`
	Context *bridgeContext  `json:"context,omitempty"`
}

// bridgeContext carries per-request context forwarded to the TS bridge.
type bridgeContext struct {
	AppID          string `json:"appId"`
	SessionID      string `json:"sessionId,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
	UserID         string `json:"userId,omitempty"`
}

// toolDescriptor is the JSON shape returned by GET /tools for each tool.
type toolDescriptor struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

func (t *BridgeTool) Name() string                 { return t.name }
func (t *BridgeTool) Description() string          { return t.description }
func (t *BridgeTool) InputSchema() json.RawMessage { return t.schema }

// Execute sends the tool input to the TS bridge and streams the NDJSON response
// into the provided OutputStream. On tool errors, the error message is written to
// both the OutputStream (via WriteError) and returned as a Go error, so callers
// can inspect either channel.
func (t *BridgeTool) Execute(ctx context.Context, input json.RawMessage, output tool.OutputStream) error {
	reqBody := bridgeRequest{Input: input}
	if scope, err := tool.ScopeFrom(ctx); err == nil {
		reqBody.Context = &bridgeContext{
			AppID:          scope.AppID,
			SessionID:      scope.SessionID,
			ConversationID: scope.ConversationID,
			UserID:         scope.UserID,
		}
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshaling bridge request: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost,
		"http://ts-bridge/tools/"+url.PathEscape(t.name),
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("creating bridge request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("bridge request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bridge returned status %d for tool %q", resp.StatusCode, t.name)
	}

	const maxLineSize = 1024 * 1024 // 1 MiB per NDJSON line.
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, maxLineSize), maxLineSize)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var parsed ndjsonLine
		if err := json.Unmarshal(line, &parsed); err != nil {
			return fmt.Errorf("decoding bridge response line: %w", err)
		}

		if parsed.Error != "" {
			output.WriteError(parsed.Error)
			return fmt.Errorf("bridge tool %q error: %s", t.name, parsed.Error)
		}

		if parsed.Chunk != "" {
			output.Write(parsed.Chunk)
		}
	}

	return scanner.Err()
}

// newHTTPClient creates an http.Client that connects via Unix domain socket.
func newHTTPClient(socketPath string) *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				var d net.Dialer
				return d.DialContext(ctx, "unix", socketPath)
			},
		},
	}
}

// DiscoverTools connects to the TS bridge and returns a BridgeTool for each
// tool the bridge exposes. It calls GET /tools on the bridge.
func DiscoverTools(ctx context.Context, socketPath string) ([]*BridgeTool, error) {
	return DiscoverToolsWithClient(ctx, newHTTPClient(socketPath))
}

// DiscoverToolsWithClient is like DiscoverTools but accepts a pre-configured
// http.Client, enabling testing without a socket path.
func DiscoverToolsWithClient(ctx context.Context, client *http.Client) ([]*BridgeTool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://ts-bridge/tools", nil)
	if err != nil {
		return nil, fmt.Errorf("creating discovery request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("discovering bridge tools: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bridge discovery returned status %d", resp.StatusCode)
	}

	var descriptors []toolDescriptor
	if err := json.NewDecoder(resp.Body).Decode(&descriptors); err != nil {
		return nil, fmt.Errorf("decoding bridge tool list: %w", err)
	}

	tools := make([]*BridgeTool, len(descriptors))
	for i, d := range descriptors {
		tools[i] = &BridgeTool{
			name:        d.Name,
			description: d.Description,
			schema:      d.InputSchema,
			client:      client,
		}
	}

	return tools, nil
}

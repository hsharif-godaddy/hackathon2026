package anthropic

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateMessage_HappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/v1/messages", r.URL.Path)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.NotEmpty(t, r.Header.Get("X-Api-Key"))
		assert.NotEmpty(t, r.Header.Get("Anthropic-Version"))

		var body struct {
			Model     string `json:"model"`
			MaxTokens int64  `json:"max_tokens"`
		}
		if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&body)) {
			return
		}
		assert.Equal(t, string(sdk.ModelClaudeSonnet4_20250514), body.Model)
		assert.Equal(t, DefaultMaxTokens, body.MaxTokens)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_test",
			"type": "message",
			"role": "assistant",
			"content": [{"type": "text", "text": "Hello!"}],
			"model": "claude-sonnet-4-20250514",
			"stop_reason": "end_turn",
			"usage": {"input_tokens": 10, "output_tokens": 5}
		}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", WithBaseURL(srv.URL), WithMaxRetries(0))
	resp, err := c.CreateMessage(context.Background(), sdk.MessageNewParams{
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Hi")),
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "msg_test", resp.ID)
	assert.Equal(t, sdk.StopReasonEndTurn, resp.StopReason)
	require.Len(t, resp.Content, 1)
	assert.Equal(t, "Hello!", resp.Content[0].Text)
	assert.Equal(t, int64(10), resp.Usage.InputTokens)
	assert.Equal(t, int64(5), resp.Usage.OutputTokens)
}

func TestCreateMessage_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(
			`{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: must be positive"}}`,
		))
	}))
	defer srv.Close()

	c := NewClient("test-key", WithBaseURL(srv.URL), WithMaxRetries(0))
	_, err := c.CreateMessage(context.Background(), sdk.MessageNewParams{
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Hi")),
		},
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid_request_error")
}

func TestCreateMessage_CustomOptions(t *testing.T) {
	var gotModel string
	var gotMaxTokens int64

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model     string `json:"model"`
			MaxTokens int64  `json:"max_tokens"`
		}
		if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&body)) {
			return
		}
		gotModel = body.Model
		gotMaxTokens = body.MaxTokens

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_custom", "type": "message", "role": "assistant",
			"content": [{"type": "text", "text": "ok"}],
			"model": "claude-opus-4-20250514", "stop_reason": "end_turn",
			"usage": {"input_tokens": 1, "output_tokens": 1}
		}`))
	}))
	defer srv.Close()

	c := NewClient("test-key",
		WithBaseURL(srv.URL),
		WithModel(sdk.ModelClaudeOpus4_20250514),
		WithMaxTokens(4096),
		WithMaxRetries(0),
	)
	_, err := c.CreateMessage(context.Background(), sdk.MessageNewParams{
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Hi")),
		},
	})

	require.NoError(t, err)
	assert.Equal(t, string(sdk.ModelClaudeOpus4_20250514), gotModel)
	assert.Equal(t, int64(4096), gotMaxTokens)
}

func TestCreateMessage_RequestOverridesClientDefaults(t *testing.T) {
	var gotModel string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&body)) {
			return
		}
		gotModel, _ = body["model"].(string)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_1", "type": "message", "role": "assistant",
			"content": [{"type": "text", "text": "ok"}],
			"model": "claude-haiku-3-20240307", "stop_reason": "end_turn",
			"usage": {"input_tokens": 1, "output_tokens": 1}
		}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", WithBaseURL(srv.URL), WithMaxRetries(0))
	_, err := c.CreateMessage(context.Background(), sdk.MessageNewParams{
		Model: "claude-haiku-3-20240307",
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Hi")),
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "claude-haiku-3-20240307", gotModel)
}

func TestCreateMessage_ContextCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer srv.Close()

	c := NewClient("test-key", WithBaseURL(srv.URL), WithMaxRetries(0))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := c.CreateMessage(ctx, sdk.MessageNewParams{
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Hi")),
		},
	})

	require.Error(t, err)
}

func TestCreateMessageStream_HappyPath(t *testing.T) {
	sseBody := "event: message_start\n" +
		"data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_s\",\"type\":\"message\"," +
		"\"role\":\"assistant\",\"content\":[],\"model\":\"claude-sonnet-4-20250514\"," +
		"\"stop_reason\":null,\"usage\":{\"input_tokens\":12,\"output_tokens\":0}}}\n" +
		"\n" +
		"event: content_block_start\n" +
		"data: {\"type\":\"content_block_start\",\"index\":0," +
		"\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n" +
		"\n" +
		"event: content_block_delta\n" +
		"data: {\"type\":\"content_block_delta\",\"index\":0," +
		"\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi there\"}}\n" +
		"\n" +
		"event: content_block_stop\n" +
		"data: {\"type\":\"content_block_stop\",\"index\":0}\n" +
		"\n" +
		"event: message_delta\n" +
		"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}," +
		"\"usage\":{\"output_tokens\":3}}\n" +
		"\n" +
		"event: message_stop\n" +
		"data: {\"type\":\"message_stop\"}\n" +
		"\n"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(sseBody))
	}))
	defer srv.Close()

	c := NewClient("test-key", WithBaseURL(srv.URL), WithMaxRetries(0))
	stream := c.CreateMessageStream(context.Background(), sdk.MessageNewParams{
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Hello")),
		},
	})
	defer stream.Close()

	// Use Accumulate to build up the full message.
	msg := sdk.Message{}
	var textDeltas []string

	for stream.Next() {
		evt := stream.Current()
		if err := msg.Accumulate(evt); err != nil {
			t.Fatalf("accumulate error: %v", err)
		}

		if evt.Type == "content_block_delta" {
			delta := evt.AsContentBlockDelta()
			if delta.Delta.Type == "text_delta" {
				textDeltas = append(textDeltas, delta.Delta.AsTextDelta().Text)
			}
		}
	}
	require.NoError(t, stream.Err())

	assert.Equal(t, "msg_s", msg.ID)
	assert.Equal(t, sdk.StopReasonEndTurn, msg.StopReason)
	require.Len(t, msg.Content, 1)
	assert.Equal(t, "Hi there", msg.Content[0].Text)
	assert.Equal(t, []string{"Hi there"}, textDeltas)
}

func TestCreateMessageStream_ToolUse(t *testing.T) {
	sseBody := "event: message_start\n" +
		"data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_t\",\"type\":\"message\"," +
		"\"role\":\"assistant\",\"content\":[],\"model\":\"claude-sonnet-4-20250514\"," +
		"\"stop_reason\":null,\"usage\":{\"input_tokens\":5,\"output_tokens\":0}}}\n" +
		"\n" +
		"event: content_block_start\n" +
		"data: {\"type\":\"content_block_start\",\"index\":0," +
		"\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"readFile\",\"input\":{}}}\n" +
		"\n" +
		"event: content_block_delta\n" +
		"data: {\"type\":\"content_block_delta\",\"index\":0," +
		"\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\": \\\"foo.txt\\\"}\"}}\n" +
		"\n" +
		"event: content_block_stop\n" +
		"data: {\"type\":\"content_block_stop\",\"index\":0}\n" +
		"\n" +
		"event: message_delta\n" +
		"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"}," +
		"\"usage\":{\"output_tokens\":10}}\n" +
		"\n" +
		"event: message_stop\n" +
		"data: {\"type\":\"message_stop\"}\n" +
		"\n"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(sseBody))
	}))
	defer srv.Close()

	c := NewClient("test-key", WithBaseURL(srv.URL), WithMaxRetries(0))
	stream := c.CreateMessageStream(context.Background(), sdk.MessageNewParams{
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Read foo.txt")),
		},
	})
	defer stream.Close()

	msg := sdk.Message{}
	for stream.Next() {
		if err := msg.Accumulate(stream.Current()); err != nil {
			t.Fatalf("accumulate error: %v", err)
		}
	}
	require.NoError(t, stream.Err())

	assert.Equal(t, sdk.StopReasonToolUse, msg.StopReason)
	require.Len(t, msg.Content, 1)
	assert.Equal(t, "tool_use", msg.Content[0].Type)
	assert.Equal(t, "readFile", msg.Content[0].Name)
	assert.Equal(t, "toolu_1", msg.Content[0].ID)
}

func TestCreateMessageStream_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(
			`{"type":"error","error":{"type":"rate_limit_error","message":"Too many requests"}}`,
		))
	}))
	defer srv.Close()

	c := NewClient("test-key", WithBaseURL(srv.URL), WithMaxRetries(0))
	stream := c.CreateMessageStream(context.Background(), sdk.MessageNewParams{
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Hi")),
		},
	})
	defer stream.Close()

	// The SDK surfaces errors via the stream iterator.
	hasEvents := stream.Next()
	assert.False(t, hasEvents)

	err := stream.Err()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "rate_limit_error")
}

func TestCreateMessage_WithTools(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&body)) {
			return
		}

		tools, ok := body["tools"].([]any)
		if assert.True(t, ok) {
			assert.Len(t, tools, 1)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_tool", "type": "message", "role": "assistant",
			"stop_reason": "tool_use",
			"content": [{"type": "tool_use", "id": "toolu_1", "name": "readFile", "input": {"path": "foo.txt"}}],
			"model": "claude-sonnet-4-20250514",
			"usage": {"input_tokens": 20, "output_tokens": 15}
		}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", WithBaseURL(srv.URL), WithMaxRetries(0))
	resp, err := c.CreateMessage(context.Background(), sdk.MessageNewParams{
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Read foo.txt")),
		},
		Tools: []sdk.ToolUnionParam{
			{
				OfTool: &sdk.ToolParam{
					Name:        "readFile",
					Description: sdk.String("Read a file"),
					InputSchema: sdk.ToolInputSchemaParam{
						Properties: map[string]any{
							"path": map[string]any{"type": "string"},
						},
					},
				},
			},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, sdk.StopReasonToolUse, resp.StopReason)
	require.Len(t, resp.Content, 1)
	assert.Equal(t, "tool_use", resp.Content[0].Type)
	assert.Equal(t, "readFile", resp.Content[0].Name)
}

func TestDefaultsApplied(t *testing.T) {
	var gotModel string
	var gotMaxTokens int64

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model     string `json:"model"`
			MaxTokens int64  `json:"max_tokens"`
		}
		if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&body)) {
			return
		}
		gotModel = body.Model
		gotMaxTokens = body.MaxTokens

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_d", "type": "message", "role": "assistant",
			"content": [{"type": "text", "text": "ok"}],
			"model": "claude-sonnet-4-20250514", "stop_reason": "end_turn",
			"usage": {"input_tokens": 1, "output_tokens": 1}
		}`))
	}))
	defer srv.Close()

	// Don't set model or max_tokens in the request — client defaults should apply.
	c := NewClient("test-key", WithBaseURL(srv.URL), WithMaxRetries(0))
	_, err := c.CreateMessage(context.Background(), sdk.MessageNewParams{
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Hi")),
		},
	})

	require.NoError(t, err)
	assert.Equal(t, string(DefaultModel), gotModel)
	assert.Equal(t, DefaultMaxTokens, gotMaxTokens)
}

func TestNewClient_Defaults(t *testing.T) {
	c := NewClient("test-key")
	assert.Equal(t, DefaultModel, c.model)
	assert.Equal(t, DefaultMaxTokens, c.maxTokens)
}

func TestCreateMessageStream_MidStreamCancellation(t *testing.T) {
	// Send one event, then block — cancel the context while stream.Next() is waiting.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("ResponseWriter does not implement Flusher")
			return
		}

		_, _ = w.Write([]byte(
			"event: message_start\n" +
				"data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_c\"," +
				"\"type\":\"message\",\"role\":\"assistant\",\"content\":[]," +
				"\"model\":\"claude-sonnet-4-20250514\",\"stop_reason\":null," +
				"\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n",
		))
		flusher.Flush()

		// Block until the request is cancelled.
		<-r.Context().Done()
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	c := NewClient("test-key", WithBaseURL(srv.URL), WithMaxRetries(0))
	stream := c.CreateMessageStream(ctx, sdk.MessageNewParams{
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock("Hi")),
		},
	})
	defer stream.Close()

	// First event should succeed.
	require.True(t, stream.Next())
	assert.Equal(t, "message_start", stream.Current().Type)

	// Cancel context — next call should fail.
	cancel()

	// stream.Next() should eventually return false due to cancellation.
	for stream.Next() {
		// Drain any buffered events.
	}
	require.Error(t, stream.Err())
}

package anthropic

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	sdk "github.com/anthropics/anthropic-sdk-go"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// Adapter implements run.LLMClient by wrapping the Anthropic SDK client.
type Adapter struct {
	client *Client
	logger *slog.Logger
}

// NewAdapter creates an LLM adapter backed by the given Anthropic client.
func NewAdapter(client *Client, logger *slog.Logger) *Adapter {
	return &Adapter{client: client, logger: logger}
}

// StreamMessage implements run.LLMClient.
func (a *Adapter) StreamMessage(
	ctx context.Context,
	model string,
	system string,
	messages []run.Message,
	tools []tool.Tool,
	onEvent func(run.StreamEvent),
) (string, []run.ToolCall, *run.Usage, error) {
	params := sdk.MessageNewParams{
		Model:  sdk.Model(model),
		System: []sdk.TextBlockParam{{Text: system}},
	}

	// Convert messages.
	for _, msg := range messages {
		var blocks []sdk.ContentBlockParamUnion
		for _, c := range msg.Content {
			block, err := convertContent(c)
			if err != nil {
				return "", nil, nil, fmt.Errorf("converting content: %w", err)
			}
			blocks = append(blocks, block)
		}
		params.Messages = append(params.Messages, sdk.MessageParam{
			Role:    sdk.MessageParamRole(msg.Role),
			Content: blocks,
		})
	}

	// Convert tools.
	for _, t := range tools {
		var schema map[string]any
		if err := json.Unmarshal(t.InputSchema(), &schema); err != nil {
			a.logger.WarnContext(ctx, "tool.schema.unmarshal.failure",
				"tool", t.Name(),
				"error", err,
			)
			// Use empty schema as fallback so the API gets a valid object.
			schema = map[string]any{"properties": map[string]any{}}
		}

		params.Tools = append(params.Tools, sdk.ToolUnionParam{
			OfTool: &sdk.ToolParam{
				Name:        t.Name(),
				Description: sdk.String(t.Description()),
				InputSchema: sdk.ToolInputSchemaParam{
					Properties: schema["properties"],
					Required:   toStringSlice(schema["required"]),
				},
			},
		})
	}

	stream := a.client.CreateMessageStream(ctx, params)
	defer stream.Close()

	var (
		fullText     strings.Builder
		toolCalls    []run.ToolCall
		currentInput strings.Builder
		currentID    string
		currentName  string
		inToolUse    bool
		usage        run.Usage
	)

	for stream.Next() {
		ev := stream.Current()

		switch ev.Type {
		case "message_start":
			// Input tokens and cache stats arrive in message_start.
			usage.InputTokens = int(ev.Message.Usage.InputTokens)
			usage.CacheRead = int(ev.Message.Usage.CacheReadInputTokens)

		case "content_block_start":
			cb := ev.ContentBlock
			if cb.Type == "tool_use" {
				inToolUse = true
				currentID = cb.ID
				currentName = cb.Name
				currentInput.Reset()
			}

		case "content_block_delta":
			delta := ev.Delta
			if delta.Text != "" && !inToolUse {
				fullText.WriteString(delta.Text)
				onEvent(run.StreamEvent{Type: "token", Text: delta.Text})
			}
			if delta.PartialJSON != "" && inToolUse {
				currentInput.WriteString(delta.PartialJSON)
			}

		case "content_block_stop":
			if inToolUse {
				toolCalls = append(toolCalls, run.ToolCall{
					ID:    currentID,
					Name:  currentName,
					Input: json.RawMessage(currentInput.String()),
				})
				inToolUse = false
			}

		case "message_delta":
			// Output tokens arrive in message_delta.
			usage.OutputTokens = int(ev.Usage.OutputTokens)
		}
	}

	if err := stream.Err(); err != nil {
		return "", nil, nil, err
	}

	return fullText.String(), toolCalls, &usage, nil
}

func convertContent(c run.Content) (sdk.ContentBlockParamUnion, error) {
	switch c.Type {
	case "text":
		return sdk.NewTextBlock(c.Text), nil
	case "tool_use":
		var input any
		if err := json.Unmarshal(c.Input, &input); err != nil {
			return sdk.ContentBlockParamUnion{}, fmt.Errorf(
				"tool_use input unmarshal for %s: %w", c.ToolUseID, err,
			)
		}
		return sdk.NewToolUseBlock(c.ToolUseID, input, c.ToolName), nil
	case "tool_result":
		return sdk.NewToolResultBlock(c.ToolUseID, c.Content, c.IsError), nil
	default:
		return sdk.NewTextBlock(c.Text), nil
	}
}

func toStringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			result = append(result, s)
		}
	}
	return result
}

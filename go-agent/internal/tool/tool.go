package tool

import (
	"context"
	"encoding/json"
)

// Tool is the interface every tool — native Go, MCP, or legacy TS bridge — implements.
type Tool interface {
	Name() string
	Description() string
	InputSchema() json.RawMessage
	Execute(ctx context.Context, input json.RawMessage, output OutputStream) error
}

// OutputStream receives incremental output from a tool execution.
type OutputStream interface {
	Write(chunk string)
	WriteError(chunk string)
	SetMetadata(key string, value any)
}

// Result holds the final output of a tool execution.
type Result struct {
	Content  string
	IsError  bool
	Metadata map[string]any
}

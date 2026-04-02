package renderer

import (
	"encoding/json"
	"time"
)

// ToolRenderer renders tool execution details for the tool detail pane.
type ToolRenderer interface {
	RenderStart(toolName string, toolID string) string
	RenderInput(toolName string, input json.RawMessage) string
	RenderResult(toolName string, input json.RawMessage, output string, errMsg string, duration time.Duration) string
}

// Registry maps tool names to their renderers.
type Registry struct {
	renderers map[string]ToolRenderer
	fallback  ToolRenderer
}

// NewRegistry creates a new registry with a DefaultRenderer as fallback.
func NewRegistry() *Registry {
	return &Registry{
		renderers: make(map[string]ToolRenderer),
		fallback:  &DefaultRenderer{},
	}
}

// Register adds a renderer for a tool name.
func (r *Registry) Register(toolName string, renderer ToolRenderer) {
	r.renderers[toolName] = renderer
}

// Get returns the renderer for a tool, or the fallback if none registered.
func (r *Registry) Get(toolName string) ToolRenderer {
	if renderer, ok := r.renderers[toolName]; ok {
		return renderer
	}
	return r.fallback
}

package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"sync"
)

// Registry resolves tool names to implementations.
// It is safe for concurrent use.
type Registry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

// NewRegistry creates an empty tool registry.
func NewRegistry() *Registry {
	return &Registry{
		tools: make(map[string]Tool),
	}
}

// Register adds a tool to the registry, keyed by its Name().
// It panics if a tool with the same name is already registered.
func (r *Registry) Register(t Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	name := t.Name()
	if _, ok := r.tools[name]; ok {
		panic(fmt.Sprintf("tool already registered: %s", name))
	}
	r.tools[name] = t
}

// Get returns the tool with the given name and true, or (nil, false) if not found.
func (r *Registry) Get(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tools[name]
	return t, ok
}

// ForAgent returns the subset of registered tools whose names appear in toolNames.
// Tools not found in the registry are silently skipped.
func (r *Registry) ForAgent(toolNames []string) []Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var tools []Tool
	for _, name := range toolNames {
		if t, ok := r.tools[name]; ok {
			tools = append(tools, t)
		}
	}
	return tools
}

// Execute looks up a tool by name and runs it. Returns an error if the tool is not found.
func (r *Registry) Execute(ctx context.Context, name string, input json.RawMessage, out OutputStream) error {
	t, ok := r.Get(name)
	if !ok {
		return fmt.Errorf("unknown tool: %s", name)
	}
	return t.Execute(ctx, input, out)
}

// All returns a snapshot copy of all registered tools.
func (r *Registry) All() map[string]Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[string]Tool, len(r.tools))
	maps.Copy(result, r.tools)
	return result
}

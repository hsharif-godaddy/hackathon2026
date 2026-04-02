package renderer

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestRegistryGetFallback(t *testing.T) {
	reg := NewRegistry()
	r := reg.Get("unknownTool")
	if r == nil {
		t.Fatal("expected fallback renderer, got nil")
	}
	if _, ok := r.(*DefaultRenderer); !ok {
		t.Fatalf("expected *DefaultRenderer, got %T", r)
	}
}

func TestRegistryGetRegistered(t *testing.T) {
	reg := NewRegistry()
	reg.Register("readFile", &FileReadRenderer{})
	r := reg.Get("readFile")
	if _, ok := r.(*FileReadRenderer); !ok {
		t.Fatalf("expected *FileReadRenderer, got %T", r)
	}
}

func TestDefaultRendererNilInput(t *testing.T) {
	r := &DefaultRenderer{}

	// Should not panic with nil input
	result := r.RenderStart("test", "id-1")
	if result == "" {
		t.Error("RenderStart returned empty")
	}

	result = r.RenderInput("test", nil)
	if result == "" {
		t.Error("RenderInput returned empty")
	}

	result = r.RenderResult("test", nil, "output", "", time.Second)
	if result == "" {
		t.Error("RenderResult returned empty")
	}
}

func TestFileReadRendererNilInput(t *testing.T) {
	r := &FileReadRenderer{}

	result := r.RenderInput("readFile", nil)
	if result == "" {
		t.Error("RenderInput with nil input returned empty")
	}

	result = r.RenderResult("readFile", nil, "line1\nline2", "", 100*time.Millisecond)
	if !strings.Contains(result, "line1") {
		t.Error("RenderResult should contain output content")
	}
}

func TestGrepRendererCorrectFields(t *testing.T) {
	r := &GrepRenderer{}

	input := json.RawMessage(`{"query":"TODO","paths":["/src"],"includePatterns":["*.go"]}`)
	result := r.RenderInput("grepSearch", input)
	if !strings.Contains(result, "TODO") {
		t.Error("RenderInput should display query")
	}
	if !strings.Contains(result, "/src") {
		t.Error("RenderInput should display paths")
	}
}

func TestFileReadRendererCorrectFields(t *testing.T) {
	r := &FileReadRenderer{}

	input := json.RawMessage(`{"path":"src/main.go","startLine":10,"numLines":5}`)
	result := r.RenderInput("readFile", input)
	if !strings.Contains(result, "src/main.go") {
		t.Error("RenderInput should display path")
	}
	if !strings.Contains(result, "10-14") {
		t.Error("RenderInput should display correct line range (10-14)")
	}
}

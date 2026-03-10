package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type echoTool struct{}

func (e *echoTool) Name() string                 { return "echo" }
func (e *echoTool) Description() string          { return "Echoes input" }
func (e *echoTool) InputSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }

func (e *echoTool) Execute(_ context.Context, input json.RawMessage, out OutputStream) error {
	out.Write(string(input))
	return nil
}

func TestRegistryRegisterAndGet(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&echoTool{})

	tool, ok := reg.Get("echo")
	require.True(t, ok)
	assert.Equal(t, "echo", tool.Name())
}

func TestRegistryGetMissing(t *testing.T) {
	reg := NewRegistry()
	_, ok := reg.Get("missing")
	assert.False(t, ok)
}

func TestRegistryForAgent(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&echoTool{})

	tools := reg.ForAgent([]string{"echo", "missing"})
	assert.Len(t, tools, 1)
	assert.Equal(t, "echo", tools[0].Name())
}

func TestRegistryExecute(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&echoTool{})

	out := &BufferedStream{}
	err := reg.Execute(context.Background(), "echo", json.RawMessage(`"hello"`), out)
	require.NoError(t, err)
	assert.Equal(t, `"hello"`, out.String())
}

func TestRegistryExecuteUnknown(t *testing.T) {
	reg := NewRegistry()
	out := &BufferedStream{}
	err := reg.Execute(context.Background(), "nope", nil, out)
	assert.Error(t, err)
}

func TestRegistryRegisterDuplicatePanics(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&echoTool{})
	assert.PanicsWithValue(t, "tool already registered: echo", func() {
		reg.Register(&echoTool{})
	})
}

func TestBufferedStream(t *testing.T) {
	s := &BufferedStream{}
	s.Write("hello ")
	s.Write("world")
	assert.Equal(t, "hello world", s.String())

	s.SetMetadata("key", "value")
	assert.Equal(t, "value", s.Metadata()["key"])
}

func TestBufferedStreamError(t *testing.T) {
	s := &BufferedStream{}
	s.WriteError("something went wrong")
	assert.Equal(t, "something went wrong", s.ErrorString())
}

func TestBufferedStreamMetadataInitiallyNil(t *testing.T) {
	s := &BufferedStream{}
	assert.Nil(t, s.Metadata())
}

func TestBufferedStreamMetadataIsDefensiveCopy(t *testing.T) {
	s := &BufferedStream{}
	s.SetMetadata("key", "value")

	m := s.Metadata()
	m["key"] = "mutated"

	assert.Equal(t, "value", s.Metadata()["key"], "mutation of returned map must not affect internal state")
}

func TestBufferedStreamStringStableAfterWrite(t *testing.T) {
	s := &BufferedStream{}
	s.Write("first")
	snap := s.String()
	s.Write("second")
	assert.Equal(t, "first", snap, "previously returned string must not change after further writes")
}

func TestBufferedStreamConcurrent(t *testing.T) {
	s := &BufferedStream{}
	const goroutines = 10
	const iterations = 100

	var wg sync.WaitGroup
	wg.Add(goroutines * 3)

	for range goroutines {
		go func() {
			defer wg.Done()
			for range iterations {
				s.Write("a")
			}
		}()
		go func() {
			defer wg.Done()
			for range iterations {
				s.WriteError("e")
			}
		}()
		go func() {
			defer wg.Done()
			for i := range iterations {
				s.SetMetadata(fmt.Sprintf("k%d", i), i)
			}
		}()
	}

	wg.Wait()

	assert.Len(t, s.String(), goroutines*iterations)
	assert.Len(t, s.ErrorString(), goroutines*iterations)
}

func TestRegistryAll(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&echoTool{})

	all := reg.All()
	assert.Len(t, all, 1)
	assert.Contains(t, all, "echo")
}

func TestRegistryForAgentEmpty(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&echoTool{})

	tools := reg.ForAgent(nil)
	assert.Empty(t, tools)
}

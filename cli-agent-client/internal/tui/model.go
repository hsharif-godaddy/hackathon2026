package tui

import (
	"encoding/json"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/cli-agent-client/internal/client"
	"github.com/airo-ai-builder/cli-agent-client/internal/renderer"
)

// FocusedPane tracks which pane has focus.
type FocusedPane int

const (
	FocusChat FocusedPane = iota
	FocusTool
	FocusInput
)

// ToolCall tracks the state of a single tool execution.
type ToolCall struct {
	ID       string
	Name     string
	Input    json.RawMessage
	Output   string
	Error    string
	Duration time.Duration
	Status   string // "running", "completed", "error"
}

// Model is the root Bubble Tea model for the CLI agent client.
type Model struct {
	// Connection
	wsClient       *client.WSClient
	connected      bool
	conversationID string

	// Panes
	chatPane ChatPane
	toolPane ToolPane
	input    Input

	// Focus
	focusedPane FocusedPane

	// Tools
	toolCalls    []ToolCall
	toolByID     map[string]int // toolID → index in toolCalls
	selectedTool int            // index into toolCalls, -1 if none
	renderers    *renderer.Registry

	// Layout
	width, height int
	splitRatio    float64

	// State
	agentResponding bool
	err             error
	ready           bool
}

// NewModel creates the root model.
func NewModel(wsClient *client.WSClient, renderers *renderer.Registry) Model {
	return Model{
		wsClient:     wsClient,
		renderers:    renderers,
		chatPane:     NewChatPane(40, 20),
		toolPane:     NewToolPane(40, 20),
		input:        NewInput(80),
		focusedPane:  FocusInput,
		selectedTool: -1,
		toolByID:     make(map[string]int),
		splitRatio:   0.5,
	}
}

// Init returns the initial command. Connection is established in main.go before Run().
func (m Model) Init() tea.Cmd {
	return nil
}

package client

import "time"

// WSConnectedMsg is sent when the server confirms connection.
type WSConnectedMsg struct {
	ConversationID string
	RunStatus      string
}

// WSChunkMsg is sent for each streamed text token.
type WSChunkMsg struct {
	Content string
}

// WSToolStartMsg is sent when a tool execution begins.
type WSToolStartMsg struct {
	ToolName string
	ToolID   string
}

// WSToolResultMsg is sent when a tool execution completes.
type WSToolResultMsg struct {
	ToolName string
	ToolID   string
	Success  bool
	Duration time.Duration
}

// WSCompleteMsg is sent when the agent run finishes.
type WSCompleteMsg struct {
	Iterations  int
	ToolsCalled int
	Cancelled   bool
	Reason      string
}

// WSErrorMsg is sent when an error occurs.
type WSErrorMsg struct {
	Message string
}

// WSDisconnectedMsg is sent when the connection is lost.
type WSDisconnectedMsg struct {
	Err error
}

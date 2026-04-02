package client

import "encoding/json"

// Client message types
const (
	MsgTypeConnect = "connect"
	MsgTypeChat    = "chat"
	MsgTypeCancel  = "cancel"
	MsgTypePing    = "ping"
)

// Server message types
const (
	MsgTypeConnected    = "connected"
	MsgTypeChunk        = "chunk"
	MsgTypeToolStart    = "tool_start"
	MsgTypeToolResult   = "tool_result"
	MsgTypeComplete     = "complete"
	MsgTypeError        = "error"
	MsgTypePong         = "pong"
	MsgTypeServerConfig = "server_config"
)

// ClientMessage sent to the go-agent server.
type ClientMessage struct {
	Type string          `json:"type"`
	ID   string          `json:"id,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

// ServerMessage received from the go-agent server.
type ServerMessage struct {
	Type    string          `json:"type"`
	Content string          `json:"content,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// ChatData is the payload for chat messages.
type ChatData struct {
	Message string `json:"message"`
	AgentID string `json:"agentId,omitempty"`
}

// ConnectData is the payload for connect messages.
type ConnectData struct {
	ConversationID string `json:"conversationId,omitempty"`
	AppID          string `json:"appId,omitempty"`
	AgentID        string `json:"agentId,omitempty"`
}

// ToolStartData is parsed from tool_start server messages.
type ToolStartData struct {
	ToolName string `json:"toolName"`
	ToolID   string `json:"toolId"`
}

// ToolResultData is parsed from tool_result server messages.
type ToolResultData struct {
	ToolName   string `json:"toolName"`
	ToolID     string `json:"toolId"`
	DurationMs int64  `json:"durationMs"`
	Success    bool   `json:"success"`
}

// CompleteData is parsed from complete server messages.
type CompleteData struct {
	Iterations  int    `json:"iterations,omitempty"`
	ToolsCalled int    `json:"toolsCalled,omitempty"`
	Cancelled   bool   `json:"cancelled,omitempty"`
	Reason      string `json:"reason,omitempty"`
}

// ConnectedData is parsed from connected server messages.
type ConnectedData struct {
	ConversationID string `json:"conversationId"`
	RunID          string `json:"runId,omitempty"`
	RunStatus      string `json:"runStatus,omitempty"`
	ReplayFrom     int    `json:"replayFrom,omitempty"`
}

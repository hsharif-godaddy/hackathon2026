package transport

import "encoding/json"

// ClientMessage is a message sent from the client to the server.
type ClientMessage struct {
	Type string          `json:"type"`
	ID   string          `json:"id,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

// ServerMessage is a message sent from the server to the client.
// The structure matches the TS agent's WebSocketMessage format.
type ServerMessage struct {
	Type    string `json:"type"`
	Content string `json:"content,omitempty"`
	Data    any    `json:"data,omitempty"`
}

// Client message types.
const (
	MsgTypeConnect = "connect"
	MsgTypeChat    = "chat"
	MsgTypeCancel  = "cancel"
	MsgTypePing    = "ping"
)

// Server message types.
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

// ChatData is the data payload for a "chat" client message.
type ChatData struct {
	Message string `json:"message"`
	AgentID string `json:"agentId,omitempty"`
}

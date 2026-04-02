package client

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// WSClient manages the WebSocket connection to the go-agent.
type WSClient struct {
	conn           *websocket.Conn
	program        *tea.Program
	url            string
	appID          string
	agentID        string
	conversationID string
	cancel         context.CancelFunc
}

// NewWSClient creates a new WebSocket client.
func NewWSClient(url, appID, agentID, conversationID string) *WSClient {
	return &WSClient{
		url:            url,
		appID:          appID,
		agentID:        agentID,
		conversationID: conversationID,
	}
}

// Connect establishes the WebSocket connection and starts the read loop.
func (c *WSClient) Connect(ctx context.Context, program *tea.Program) error {
	c.program = program

	conn, _, err := websocket.Dial(ctx, c.url, nil)
	if err != nil {
		return fmt.Errorf("dial %s: %w", c.url, err)
	}
	c.conn = conn
	// Allow large messages from agent (tool results can be big)
	c.conn.SetReadLimit(10 * 1024 * 1024)

	readCtx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	go c.readLoop(readCtx)

	return nil
}

// SendConnect sends the initial connect message.
func (c *WSClient) SendConnect() error {
	data := ConnectData{
		ConversationID: c.conversationID,
		AppID:          c.appID,
		AgentID:        c.agentID,
	}
	return c.sendMessage(MsgTypeConnect, data)
}

// SendChat sends a chat message to the agent.
func (c *WSClient) SendChat(message string) error {
	data := ChatData{
		Message: message,
		AgentID: c.agentID,
	}
	return c.sendMessage(MsgTypeChat, data)
}

// SendCancel sends a cancel message to stop the active run.
func (c *WSClient) SendCancel() error {
	return c.sendMessage(MsgTypeCancel, nil)
}

// Close closes the WebSocket connection.
func (c *WSClient) Close() error {
	if c.cancel != nil {
		c.cancel()
	}
	if c.conn != nil {
		return c.conn.Close(websocket.StatusNormalClosure, "client closing")
	}
	return nil
}

func (c *WSClient) sendMessage(msgType string, data any) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}

	msg := ClientMessage{Type: msgType}
	if data != nil {
		raw, err := json.Marshal(data)
		if err != nil {
			return fmt.Errorf("marshal data: %w", err)
		}
		msg.Data = raw
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return wsjson.Write(ctx, c.conn, msg)
}

func (c *WSClient) readLoop(ctx context.Context) {
	var loopErr error
	defer func() {
		c.program.Send(WSDisconnectedMsg{Err: loopErr})
	}()

	for {
		var msg ServerMessage
		err := wsjson.Read(ctx, c.conn, &msg)
		if err != nil {
			if ctx.Err() != nil {
				return // context cancelled, clean shutdown
			}
			loopErr = err
			return
		}

		switch msg.Type {
		case MsgTypeConnected:
			var data ConnectedData
			if err := json.Unmarshal(msg.Data, &data); err != nil {
				c.program.Send(WSErrorMsg{Message: fmt.Sprintf("malformed connected message: %v", err)})
				continue
			}
			c.program.Send(WSConnectedMsg{
				ConversationID: data.ConversationID,
				RunStatus:      data.RunStatus,
			})

		case MsgTypeChunk:
			c.program.Send(WSChunkMsg{Content: msg.Content})

		case MsgTypeToolStart:
			var data ToolStartData
			if err := json.Unmarshal(msg.Data, &data); err != nil {
				c.program.Send(WSErrorMsg{Message: fmt.Sprintf("malformed tool_start message: %v", err)})
				continue
			}
			c.program.Send(WSToolStartMsg{
				ToolName: data.ToolName,
				ToolID:   data.ToolID,
			})

		case MsgTypeToolResult:
			var data ToolResultData
			if err := json.Unmarshal(msg.Data, &data); err != nil {
				c.program.Send(WSErrorMsg{Message: fmt.Sprintf("malformed tool_result message: %v", err)})
				continue
			}
			c.program.Send(WSToolResultMsg{
				ToolName: data.ToolName,
				ToolID:   data.ToolID,
				Success:  data.Success,
				Duration: time.Duration(data.DurationMs) * time.Millisecond,
			})

		case MsgTypeComplete:
			var data CompleteData
			if err := json.Unmarshal(msg.Data, &data); err != nil {
				c.program.Send(WSErrorMsg{Message: fmt.Sprintf("malformed complete message: %v", err)})
				continue
			}
			c.program.Send(WSCompleteMsg{
				Iterations:  data.Iterations,
				ToolsCalled: data.ToolsCalled,
				Cancelled:   data.Cancelled,
				Reason:      data.Reason,
			})

		case MsgTypeError:
			c.program.Send(WSErrorMsg{Message: msg.Content})

		case MsgTypeServerConfig, MsgTypePong:
			// Ignored for now
		}
	}
}

package transport

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/coder/websocket"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/id"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/session"
)

// AuthFunc validates an HTTP request and returns the authenticated appID.
// Return an error to reject the connection.
type AuthFunc func(r *http.Request) (appID string, err error)

// Server handles WebSocket connections and translates between the wire
// protocol and the session manager.
type Server struct {
	sessionMgr *session.Manager
	runStore   *run.Store
	authFunc   AuthFunc
	logger     *slog.Logger
}

// NewServer creates a WebSocket transport server.
func NewServer(
	mgr *session.Manager,
	runStore *run.Store,
	authFunc AuthFunc,
	logger *slog.Logger,
) *Server {
	return &Server{
		sessionMgr: mgr,
		runStore:   runStore,
		authFunc:   authFunc,
		logger:     logger,
	}
}

// Handler returns an http.Handler that upgrades connections to WebSocket.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		appID, err := s.authFunc(r)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true, // Origin check disabled; enforced at proxy layer.
		})
		if err != nil {
			s.logger.Error("websocket.accept.failure", "error", err)
			return
		}

		connID := id.New("ws")
		s.handleConnection(r.Context(), conn, connID, appID)
	})
}

// connState holds per-connection state including the write serializer and
// the active stream goroutine's cancel function.
type connState struct {
	conn *websocket.Conn
	mu   sync.Mutex // serializes writes

	streamMu     sync.Mutex         // guards streamCancel
	streamCancel context.CancelFunc // cancels the active streamRunEvents goroutine
}

func (cs *connState) writeJSON(ctx context.Context, msg ServerMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	cs.mu.Lock()
	defer cs.mu.Unlock()
	return cs.conn.Write(ctx, websocket.MessageText, data)
}

// startStream cancels any active stream goroutine and starts a new one.
func (cs *connState) startStream(
	ctx context.Context,
	s *Server,
	runID string,
	fromSeq int64,
) {
	cs.streamMu.Lock()
	if cs.streamCancel != nil {
		cs.streamCancel()
	}
	streamCtx, cancel := context.WithCancel(ctx)
	cs.streamCancel = cancel
	cs.streamMu.Unlock()

	go s.streamRunEvents(streamCtx, cs, runID, fromSeq)
}

func (s *Server) handleConnection(
	ctx context.Context,
	conn *websocket.Conn,
	connID string,
	appID string,
) {
	cs := &connState{conn: conn}
	defer func() {
		cs.streamMu.Lock()
		if cs.streamCancel != nil {
			cs.streamCancel()
		}
		cs.streamMu.Unlock()
		s.sessionMgr.HandleDisconnect(connID)
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}()

	// Send server config on connect.
	if err := cs.writeJSON(ctx, ServerMessage{
		Type: MsgTypeServerConfig,
		Data: map[string]any{
			"streamRecoveryWindow": 120000,
		},
	}); err != nil {
		return
	}

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return // Connection closed or error.
		}

		var msg ClientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			_ = cs.writeJSON(ctx, ServerMessage{
				Type:    MsgTypeError,
				Content: "invalid JSON",
			})
			continue
		}

		s.dispatch(ctx, cs, connID, appID, msg)
	}
}

func (s *Server) dispatch(
	ctx context.Context,
	cs *connState,
	connID string,
	appID string,
	msg ClientMessage,
) {
	switch msg.Type {
	case MsgTypePing:
		_ = cs.writeJSON(ctx, ServerMessage{Type: MsgTypePong})

	case MsgTypeConnect:
		s.handleConnect(ctx, cs, connID, appID, msg)

	case MsgTypeChat:
		s.handleChat(ctx, cs, connID, msg)

	case MsgTypeCancel:
		s.handleCancel(ctx, cs, connID)

	default:
		_ = cs.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: "unknown message type: " + msg.Type,
		})
	}
}

func (s *Server) handleConnect(
	ctx context.Context,
	cs *connState,
	connID string,
	appID string,
	msg ClientMessage,
) {
	var data session.ConnectData
	if msg.Data != nil {
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			_ = cs.writeJSON(ctx, ServerMessage{
				Type:    MsgTypeError,
				Content: "invalid connect data",
			})
			return
		}
	}
	data.AppID = appID

	resp, err := s.sessionMgr.HandleConnect(connID, data)
	if err != nil {
		_ = cs.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: err.Error(),
		})
		return
	}

	_ = cs.writeJSON(ctx, ServerMessage{
		Type: MsgTypeConnected,
		Data: resp,
	})

	// If there's an active run with replay, subscribe and stream events.
	if resp.RunID != "" && resp.ReplayFrom != nil {
		cs.startStream(ctx, s, resp.RunID, *resp.ReplayFrom)
	}
}

func (s *Server) handleChat(
	ctx context.Context,
	cs *connState,
	connID string,
	msg ClientMessage,
) {
	if msg.Data == nil {
		_ = cs.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: "missing chat data",
		})
		return
	}

	var data ChatData
	if err := json.Unmarshal(msg.Data, &data); err != nil {
		_ = cs.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: "invalid chat data",
		})
		return
	}

	runID, err := s.sessionMgr.HandleMessage(connID, data.Message)
	if err != nil {
		_ = cs.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: err.Error(),
		})
		return
	}

	// Cancel any previous stream and start streaming the new run.
	cs.startStream(ctx, s, runID, 0)
}

func (s *Server) handleCancel(
	ctx context.Context,
	cs *connState,
	connID string,
) {
	if err := s.sessionMgr.HandleCancel(connID); err != nil {
		_ = cs.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: err.Error(),
		})
	}
}

// streamRunEvents subscribes to the run store and forwards events to the
// WebSocket client, translating internal event types to the wire protocol.
// It exits when the run completes, the context is cancelled, or the
// subscription channel is closed.
func (s *Server) streamRunEvents(
	ctx context.Context,
	cs *connState,
	runID string,
	fromSeq int64,
) {
	ch, cancel := s.runStore.Subscribe(runID, fromSeq)
	defer cancel()

	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			msg := translateEvent(ev)
			if msg == nil {
				continue
			}
			if err := cs.writeJSON(ctx, *msg); err != nil {
				return
			}
			// Stop streaming after terminal events.
			if isTerminalMessage(msg.Type) {
				return
			}
		}
	}
}

// isTerminalMessage returns true for message types that indicate a run has
// ended, so the streaming goroutine should exit.
func isTerminalMessage(msgType string) bool {
	return msgType == MsgTypeComplete || msgType == MsgTypeError
}

// translateEvent converts a run.Event to a ServerMessage for the wire protocol.
// Returns nil for events that should not be sent to the client.
func translateEvent(ev run.Event) *ServerMessage {
	switch data := ev.Data.(type) {
	case run.TokenData:
		return &ServerMessage{
			Type:    MsgTypeChunk,
			Content: data.Text,
		}

	case run.ToolStartData:
		return &ServerMessage{
			Type: MsgTypeToolStart,
			Data: map[string]any{
				"toolName": data.Name,
				"toolId":   data.ID,
			},
		}

	case run.ToolResultData:
		return &ServerMessage{
			Type: MsgTypeToolResult,
			Data: map[string]any{
				"toolName":   data.Name,
				"toolId":     data.ID,
				"durationMs": data.Duration.Milliseconds(),
				"success":    data.ErrMsg == "",
			},
		}

	case run.CompletedData:
		return &ServerMessage{
			Type: MsgTypeComplete,
			Data: map[string]any{
				"iterations":  data.Iterations,
				"toolsCalled": data.ToolsCalled,
			},
		}

	case run.CancelledData:
		return &ServerMessage{
			Type: MsgTypeComplete,
			Data: map[string]any{
				"cancelled": true,
				"reason":    data.Reason,
			},
		}

	case run.FailedData:
		return &ServerMessage{
			Type:    MsgTypeError,
			Content: data.Error,
		}

	default:
		return nil
	}
}

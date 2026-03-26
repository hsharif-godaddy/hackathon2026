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

func (s *Server) handleConnection(
	ctx context.Context,
	conn *websocket.Conn,
	connID string,
	appID string,
) {
	w := &connWriter{conn: conn}
	defer func() {
		s.sessionMgr.HandleDisconnect(connID)
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}()

	// Send server config on connect.
	if err := w.writeJSON(ctx, ServerMessage{
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
			_ = w.writeJSON(ctx, ServerMessage{
				Type:    MsgTypeError,
				Content: "invalid JSON",
			})
			continue
		}

		s.dispatch(ctx, w, connID, appID, msg)
	}
}

func (s *Server) dispatch(
	ctx context.Context,
	w *connWriter,
	connID string,
	appID string,
	msg ClientMessage,
) {
	switch msg.Type {
	case MsgTypePing:
		_ = w.writeJSON(ctx, ServerMessage{Type: MsgTypePong})

	case MsgTypeConnect:
		s.handleConnect(ctx, w, connID, appID, msg)

	case MsgTypeChat:
		s.handleChat(ctx, w, connID, msg)

	case MsgTypeCancel:
		s.handleCancel(ctx, w, connID)

	default:
		_ = w.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: "unknown message type: " + msg.Type,
		})
	}
}

func (s *Server) handleConnect(
	ctx context.Context,
	w *connWriter,
	connID string,
	appID string,
	msg ClientMessage,
) {
	var data session.ConnectData
	if msg.Data != nil {
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			_ = w.writeJSON(ctx, ServerMessage{
				Type:    MsgTypeError,
				Content: "invalid connect data",
			})
			return
		}
	}
	data.AppID = appID

	resp, err := s.sessionMgr.HandleConnect(connID, data)
	if err != nil {
		_ = w.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: err.Error(),
		})
		return
	}

	_ = w.writeJSON(ctx, ServerMessage{
		Type: MsgTypeConnected,
		Data: resp,
	})

	// If there's an active run with replay, subscribe and stream events.
	if resp.RunID != "" && resp.ReplayFrom != nil {
		go s.streamRunEvents(ctx, w, resp.RunID, *resp.ReplayFrom)
	}
}

func (s *Server) handleChat(
	ctx context.Context,
	w *connWriter,
	connID string,
	msg ClientMessage,
) {
	if msg.Data == nil {
		_ = w.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: "missing chat data",
		})
		return
	}

	var data ChatData
	if err := json.Unmarshal(msg.Data, &data); err != nil {
		_ = w.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: "invalid chat data",
		})
		return
	}

	runID, err := s.sessionMgr.HandleMessage(connID, data.Message)
	if err != nil {
		_ = w.writeJSON(ctx, ServerMessage{
			Type:    MsgTypeError,
			Content: err.Error(),
		})
		return
	}

	// Stream events from the new run.
	go s.streamRunEvents(ctx, w, runID, 0)
}

func (s *Server) handleCancel(
	ctx context.Context,
	w *connWriter,
	connID string,
) {
	if err := s.sessionMgr.HandleCancel(connID); err != nil {
		_ = w.writeJSON(ctx, ServerMessage{
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
	w *connWriter,
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
			if err := w.writeJSON(ctx, *msg); err != nil {
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

// connWriter serializes writes to a websocket.Conn which is not safe for
// concurrent use.
type connWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (w *connWriter) writeJSON(ctx context.Context, msg ServerMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.Write(ctx, websocket.MessageText, data)
}

package session

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/id"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/store"
)

// Default budget limits for new runs.
const (
	DefaultMaxToolCalls = 100
	DefaultMaxTokens    = 200000
)

// Errors returned by the session manager.
var (
	ErrSessionNotFound    = errors.New("session not found")
	ErrNoActiveRun        = errors.New("no active run")
	ErrConversationNotOwn = errors.New("conversation does not belong to app")
)

// ConnectData is sent by the client when establishing a connection.
type ConnectData struct {
	AppID          string `json:"appId"`
	ConversationID string `json:"conversationId,omitempty"`
	LastSequence   *int64 `json:"lastSeq,omitempty"`
	AgentID        string `json:"agentId,omitempty"`
}

// ConnectResponse is returned to the client after a connect.
type ConnectResponse struct {
	ConversationID string `json:"conversationId"`
	RunID          string `json:"runId,omitempty"`
	RunStatus      string `json:"runStatus,omitempty"`
	ReplayFrom     *int64 `json:"replayFrom,omitempty"`
}

// Session represents an active WebSocket connection.
type Session struct {
	ConnectionID   string
	AppID          string
	ConversationID string
	AgentID        string
	ActiveRunID    string
}

// convRef is a composite key for the runsByConv map, avoiding string
// concatenation collisions.
type convRef struct {
	appID  string
	convID string
}

// Manager coordinates sessions, conversations, and runs.
// It is the bridge between the WebSocket transport and the run engine.
type Manager struct {
	mu          sync.RWMutex
	sessions    map[string]*Session           // connectionID → session
	runsByConv  map[convRef]string            // (appID, convID) → runID
	cancelByRun map[string]context.CancelFunc // runID → cancel

	runEngine *run.Engine
	runStore  *run.Store
	convRepo  *store.ConversationRepo
	msgRepo   *store.MessageRepo
	llm       run.LLMClient
}

// NewManager creates a session manager with the given dependencies.
func NewManager(
	engine *run.Engine,
	runStore *run.Store,
	convRepo *store.ConversationRepo,
	msgRepo *store.MessageRepo,
	llm run.LLMClient,
) *Manager {
	return &Manager{
		sessions:    make(map[string]*Session),
		runsByConv:  make(map[convRef]string),
		cancelByRun: make(map[string]context.CancelFunc),
		runEngine:   engine,
		runStore:    runStore,
		convRepo:    convRepo,
		msgRepo:     msgRepo,
		llm:         llm,
	}
}

// HandleConnect processes a new WebSocket connection.
// It implements the four connection cases from the design doc.
func (m *Manager) HandleConnect(
	connID string,
	data ConnectData,
) (*ConnectResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	agentID := data.AgentID
	if agentID == "" {
		agentID = "develop"
	}

	sess := &Session{
		ConnectionID: connID,
		AppID:        data.AppID,
		AgentID:      agentID,
	}

	// Case 1/2: Client provides a conversationId — validate ownership.
	if data.ConversationID != "" {
		if err := m.validateConversation(data.ConversationID, data.AppID); err != nil {
			return nil, err
		}
		sess.ConversationID = data.ConversationID

		resp, err := m.connectWithConversation(sess, data.AppID, data.ConversationID, data.LastSequence)
		if err != nil {
			return nil, err
		}
		m.sessions[connID] = sess
		return resp, nil
	}

	// Case 3: AppID only — look up most recent conversation.
	conv, err := m.convRepo.GetLatestForApp(context.Background(), data.AppID)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, fmt.Errorf("looking up latest conversation: %w", err)
	}
	if conv != nil {
		sess.ConversationID = conv.ID
		zero := int64(0)
		resp, err := m.connectWithConversation(sess, data.AppID, conv.ID, &zero)
		if err != nil {
			return nil, err
		}
		m.sessions[connID] = sess
		return resp, nil
	}

	// Case 4: Fresh — no conversation yet.
	m.sessions[connID] = sess
	return &ConnectResponse{}, nil
}

// connectWithConversation builds a ConnectResponse for a known conversation,
// attaching to an active run if one exists. Must be called with m.mu held.
func (m *Manager) connectWithConversation(
	sess *Session,
	appID string,
	convID string,
	lastSeq *int64,
) (*ConnectResponse, error) {
	ref := convRef{appID: appID, convID: convID}
	runID, hasRun := m.runsByConv[ref]
	if !hasRun {
		return &ConnectResponse{ConversationID: convID}, nil
	}

	sess.ActiveRunID = runID

	replayFrom := lastSeq
	if replayFrom == nil {
		zero := int64(0)
		replayFrom = &zero
	}

	r, err := m.runStore.Get(runID)
	if err != nil {
		return nil, fmt.Errorf("getting run: %w", err)
	}

	return &ConnectResponse{
		ConversationID: convID,
		RunID:          runID,
		RunStatus:      string(r.Status),
		ReplayFrom:     replayFrom,
	}, nil
}

// HandleMessage processes a chat message from the client.
// It creates a conversation if needed, starts a new run, and executes it
// in a background goroutine. Returns the run ID.
func (m *Manager) HandleMessage(
	connID string,
	message string,
) (string, error) {
	m.mu.Lock()

	sess, ok := m.sessions[connID]
	if !ok {
		m.mu.Unlock()
		return "", ErrSessionNotFound
	}

	// Cancel any active run on this conversation before starting a new one.
	// This prevents leaked goroutines and orphaned cancel functions.
	if sess.ActiveRunID != "" {
		if cancel, ok := m.cancelByRun[sess.ActiveRunID]; ok {
			cancel()
			delete(m.cancelByRun, sess.ActiveRunID)
		}
		sess.ActiveRunID = ""
	}

	// Create conversation if this is the first message.
	if sess.ConversationID == "" {
		convID := id.New("conv")
		_, err := m.convRepo.Create(
			context.Background(),
			convID,
			sess.AppID,
			sess.AgentID,
			nil,
		)
		if err != nil {
			m.mu.Unlock()
			return "", fmt.Errorf("creating conversation: %w", err)
		}
		sess.ConversationID = convID
	}

	// Persist user message.
	msgID := id.New("msg")
	_, err := m.msgRepo.Add(
		context.Background(),
		msgID,
		sess.ConversationID,
		"user",
		message,
		nil,
	)
	if err != nil {
		m.mu.Unlock()
		return "", fmt.Errorf("persisting user message: %w", err)
	}

	// Create a new run.
	runID := id.New("run")
	r := &run.Run{
		ID:             runID,
		AppID:          sess.AppID,
		ConversationID: sess.ConversationID,
		AgentID:        sess.AgentID,
		Status:         run.StatusCreated,
		Budget: run.Budget{
			MaxToolCalls: DefaultMaxToolCalls,
			MaxTokens:    DefaultMaxTokens,
		},
		CreatedAt: time.Now(),
	}

	if err := m.runStore.Create(r); err != nil {
		m.mu.Unlock()
		return "", fmt.Errorf("creating run: %w", err)
	}

	sess.ActiveRunID = runID
	ref := convRef{appID: sess.AppID, convID: sess.ConversationID}
	m.runsByConv[ref] = runID

	ctx, cancel := context.WithCancel(context.Background())
	m.cancelByRun[runID] = cancel

	m.mu.Unlock()

	// Execute in background.
	go func() {
		m.runEngine.Execute(ctx, m.llm, r, message)

		m.mu.Lock()
		delete(m.cancelByRun, runID)
		if m.runsByConv[ref] == runID {
			delete(m.runsByConv, ref)
		}
		m.mu.Unlock()
	}()

	return runID, nil
}

// validateConversation checks that the conversation exists and belongs to the
// given app. Must be called with m.mu held.
func (m *Manager) validateConversation(convID, appID string) error {
	conv, err := m.convRepo.GetByID(context.Background(), convID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return fmt.Errorf("conversation %s: %w", convID, store.ErrNotFound)
		}
		return fmt.Errorf("looking up conversation: %w", err)
	}
	if conv.AppID != appID {
		return fmt.Errorf(
			"conversation %s belongs to app %s, not %s: %w",
			convID, conv.AppID, appID, ErrConversationNotOwn,
		)
	}
	return nil
}

// HandleCancel cancels the active run for the given connection.
func (m *Manager) HandleCancel(connID string) error {
	m.mu.RLock()
	sess, ok := m.sessions[connID]
	if !ok {
		m.mu.RUnlock()
		return ErrSessionNotFound
	}
	runID := sess.ActiveRunID
	cancel := m.cancelByRun[runID]
	m.mu.RUnlock()

	if cancel == nil {
		return ErrNoActiveRun
	}

	cancel()
	return nil
}

// HandleDisconnect removes the session. Active runs continue.
func (m *Manager) HandleDisconnect(connID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, connID)
}

// GetSession returns a copy of the session for the given connection ID.
func (m *Manager) GetSession(connID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sess, ok := m.sessions[connID]
	if !ok {
		return nil, ErrSessionNotFound
	}
	sessCopy := *sess
	return &sessCopy, nil
}

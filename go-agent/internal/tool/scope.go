package tool

import (
	"context"
	"errors"
)

// ErrNoScope is returned when RequestScope is not present in the context.
var ErrNoScope = errors.New("no RequestScope in context")

// RequestScope carries per-request state that tools need.
// Tools are stateless singletons; all per-app state lives here.
type RequestScope struct {
	AppID          string
	AppRoot        string
	SupervisorAddr string // "unix:/var/run/supervisor.sock" or "http://localhost:8080"
	SessionID      string // Optional: forwarded to TS bridge for context propagation
	ConversationID string // Optional: forwarded to TS bridge for context propagation
	UserID         string // Optional: forwarded to TS bridge for context propagation
}

type scopeKey struct{}

// WithScope attaches a RequestScope to the context.
func WithScope(ctx context.Context, scope RequestScope) context.Context {
	return context.WithValue(ctx, scopeKey{}, scope)
}

// ScopeFrom extracts the RequestScope from the context.
func ScopeFrom(ctx context.Context) (RequestScope, error) {
	v, ok := ctx.Value(scopeKey{}).(RequestScope)
	if !ok {
		return RequestScope{}, ErrNoScope
	}
	return v, nil
}

// TestContext returns a context with a RequestScope containing the given appRoot.
// This is a convenience helper for tests.
func TestContext(appRoot string) context.Context {
	return WithScope(context.Background(), RequestScope{AppRoot: appRoot})
}

// TestContextWithSupervisor returns a context with a RequestScope containing
// the given appRoot and supervisor address. This is for terminal tool tests.
func TestContextWithSupervisor(appRoot, addr string) context.Context {
	return WithScope(context.Background(), RequestScope{
		AppRoot:        appRoot,
		SupervisorAddr: addr,
	})
}

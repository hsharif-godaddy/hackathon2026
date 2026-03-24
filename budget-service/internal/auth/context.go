// internal/auth/context.go
package auth

import (
	"context"
	"net/http"
)

type contextKey string

const authContextKey contextKey = "authContext"

// WithAuthContext attaches AuthContext to the request context.
func WithAuthContext(ctx context.Context, authCtx *AuthContext) context.Context {
	return context.WithValue(ctx, authContextKey, authCtx)
}

// GetAuthContext retrieves AuthContext from the request.
// Returns nil if not present.
func GetAuthContext(r *http.Request) *AuthContext {
	val := r.Context().Value(authContextKey)
	if val == nil {
		return nil
	}
	return val.(*AuthContext)
}

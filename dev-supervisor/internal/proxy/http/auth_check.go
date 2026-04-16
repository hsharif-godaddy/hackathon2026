package httpproxy

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// authCheckResponse is the JSON response for the auth-check endpoint.
type authCheckResponse struct {
	Authenticated bool `json:"authenticated"`
	CookieAuth    bool `json:"cookieAuth"`
}

// handleAuthCheck returns authentication status. Since this endpoint is behind
// JWT middleware, reaching it means the request is authenticated. The cookieAuth
// field indicates whether authentication came from a cookie (true) or an
// Authorization header (false).
func handleAuthCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if preview_auth cookie is present - this is the cookie set by JWT middleware
	// during auth bootstrap. Checking the cookie directly is more accurate than
	// inferring from Authorization header absence (which would misreport share-token auth).
	_, hasCookie := r.Cookie("preview_auth")

	resp := authCheckResponse{
		Authenticated: true,
		CookieAuth:    hasCookie == nil,
	}

	slog.Debug("auth_check.ok", "cookie_auth", resp.CookieAuth, "path", r.URL.Path)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Error("auth_check.encode_error", "error", err)
	}
}

package middleware

import (
	"log/slog"
	"net/http"
)

// allowedHTTPMethods defines the HTTP methods accepted by the reverse proxy
// Matches RFC 9110 safe and unsafe methods commonly used in REST APIs
// Rejects CONNECT and TRACE for security (prevent tunneling and XST attacks)
var allowedHTTPMethods = map[string]bool{
	http.MethodGet:     true,
	http.MethodHead:    true,
	http.MethodPost:    true,
	http.MethodPut:     true,
	http.MethodPatch:   true,
	http.MethodDelete:  true,
	http.MethodOptions: true,
}

// MethodValidation validates HTTP methods and rejects unsupported ones
// Single responsibility: Enforce allowed HTTP methods at the edge
func MethodValidation(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Validate HTTP method - reject unsupported methods
		// Allowed: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS
		// Reject: CONNECT, TRACE, and any unknown methods
		if !allowedHTTPMethods[r.Method] {
			slog.Debug("http.method.rejected",
				"method", r.Method,
				"path", r.URL.Path,
				"remote_addr", r.RemoteAddr)
			w.Header().Set("Allow", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		next.ServeHTTP(w, r)
	})
}

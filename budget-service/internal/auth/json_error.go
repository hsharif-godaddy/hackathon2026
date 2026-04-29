package auth

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// writeAuthError writes a JSON body aligned with api.writeError: {"error","code"}.
func writeAuthError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]string{"error": message, "code": code}); err != nil {
		slog.Error("auth.write_error", "error", err)
	}
}

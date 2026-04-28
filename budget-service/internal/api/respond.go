package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// writeJSON writes JSON; logs encoding errors.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("api.write_json", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": message, "code": code})
}

// writeInternalError logs err and returns a generic JSON error body (no stack or wrapped text).
func writeInternalError(w http.ResponseWriter, op string, err error) {
	slog.Error(op, "error", err)
	writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
}

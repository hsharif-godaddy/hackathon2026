package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
)

// budgetMaxBodyBytes caps JSON request bodies. When LOG_REQUEST_BODIES is true, POST/PATCH
// middleware buffers up to this size before handlers; otherwise decodeJSONBody's MaxBytesReader
// is the first line of defense for oversized bodies.
const budgetMaxBodyBytes = 1 << 20

func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any, allowEmpty bool) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, budgetMaxBodyBytes))
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) && allowEmpty {
			return true
		}
		writeDecodeError(w, err)
		return false
	}

	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return false
	}
	return true
}

func writeDecodeError(w http.ResponseWriter, err error) {
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		writeError(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "request body too large")
		return
	}
	if strings.HasPrefix(err.Error(), "json: unknown field ") {
		slog.Warn("api.decode_json", "error", err)
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
}

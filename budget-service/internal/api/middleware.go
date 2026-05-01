package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode"
)

const maxLogFieldLen = 512

// maxPayloadLogLen caps logged request body size for Kibana/JSON lines (full body is still buffered up to budgetMaxBodyBytes for handlers).
const maxPayloadLogLen = 65536

var errRequestBodyTooLarge = errors.New("request body too large")

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func newResponseWriter(w http.ResponseWriter) *responseWriter {
	return &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// RequireJSONContentType rejects POST/PATCH requests that do not declare application/json.
func RequireJSONContentType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost || r.Method == http.MethodPatch {
			ct := r.Header.Get("Content-Type")
			mt := strings.TrimSpace(strings.SplitN(ct, ";", 2)[0])
			if !strings.EqualFold(mt, "application/json") {
				writeError(w, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// LoggingMiddleware wraps the entire handler (including mux NotFound/MethodNotAllowed) so
// every response emits an access log line.
func LoggingMiddleware(next http.Handler, logRequestBodies bool) http.Handler {
	return newLoggingMiddleware(slog.Default(), next, logRequestBodies)
}

func newLoggingMiddleware(logger *slog.Logger, next http.Handler, logRequestBodies bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := newResponseWriter(w)

		sanitizedBodyForLog := ""
		if logRequestBodies && (r.Method == http.MethodPost || r.Method == http.MethodPatch) {
			body, err := readAndReplaceRequestBody(r, int64(budgetMaxBodyBytes))
			if err != nil {
				if errors.Is(err, errRequestBodyTooLarge) {
					writeError(rw, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "request body too large")
				} else {
					writeError(rw, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
				}
				logger.Info("http.request.complete",
					"method", r.Method,
					"path", sanitizeLogValue(r.URL.Path),
					"status", rw.statusCode,
					"durationMs", time.Since(start).Milliseconds(),
					"userAgent", sanitizeLogValue(r.UserAgent()),
				)
				return
			}
			sanitizedBodyForLog = sanitizeAndTruncate(string(body), maxPayloadLogLen)
		}

		next.ServeHTTP(rw, r)

		attrs := []any{
			"method", r.Method,
			"path", sanitizeLogValue(r.URL.Path),
			"status", rw.statusCode,
			"durationMs", time.Since(start).Milliseconds(),
			"userAgent", sanitizeLogValue(r.UserAgent()),
		}
		if logRequestBodies && (r.Method == http.MethodPost || r.Method == http.MethodPatch) {
			if v, ok := requestBodyForLog(sanitizedBodyForLog); ok {
				attrs = append(attrs, "requestBody", v)
			} else {
				attrs = append(attrs, "requestBodyRaw", sanitizedBodyForLog)
			}
		}
		logger.Info("http.request.complete", attrs...)
	})
}

func readAndReplaceRequestBody(r *http.Request, max int64) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > max {
		return nil, errRequestBodyTooLarge
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	return body, nil
}

// requestBodyForLog returns a parsed object or array and true when the body is JSON
// and should be logged as structured requestBody. Scalars, non-JSON, and empty bodies
// are logged under requestBodyRaw to avoid mixed-type conflicts in Elasticsearch
// and to keep object-shaped bodies on a single mapping.
func requestBodyForLog(sanitized string) (structural any, ok bool) {
	if sanitized == "" {
		return nil, false
	}
	var v any
	if err := json.Unmarshal([]byte(sanitized), &v); err != nil {
		return nil, false
	}
	switch v := v.(type) {
	case map[string]any:
		return sanitizeValueTreeForLog(v), true
	case []any:
		return sanitizeValueTreeForLog(v), true
	default:
		return nil, false
	}
}

func sanitizeValueTreeForLog(v any) any {
	switch t := v.(type) {
	case map[string]any:
		m := make(map[string]any, len(t))
		for k, val := range t {
			k2 := removeControlFromString(k)
			if k2 == "" {
				k2 = k
			}
			m[k2] = sanitizeValueTreeForLog(val)
		}
		return m
	case []any:
		s := make([]any, len(t))
		for i, x := range t {
			s[i] = sanitizeValueTreeForLog(x)
		}
		return s
	case string:
		return removeControlFromString(t)
	default:
		return t
	}
}

func removeControlFromString(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
}

func sanitizeAndTruncate(s string, maxRunes int) string {
	var b strings.Builder
	n := 0
	for _, r := range s {
		if unicode.IsControl(r) {
			continue
		}
		if n >= maxRunes {
			break
		}
		b.WriteRune(r)
		n++
	}
	return b.String()
}

func sanitizeLogValue(s string) string {
	return sanitizeAndTruncate(s, maxLogFieldLen)
}

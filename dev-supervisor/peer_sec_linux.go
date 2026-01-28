//go:build linux

package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

// SELinuxContext represents a parsed SELinux security context
type SELinuxContext struct {
	User  string // e.g., "system_u"
	Role  string // e.g., "system_r"
	Type  string // e.g., "container_t" or "airo_agent_container.process"
	Level string // e.g., "s0:c1,c2"
	Raw   string // The full raw context string
}

type peerSecContextKey struct{}

// getPeerSecContext extracts SELinux security context using SO_PEERSEC
func getPeerSecContext(conn net.Conn) (*SELinuxContext, error) {
	unixConn, ok := conn.(*net.UnixConn)
	if !ok {
		return nil, fmt.Errorf("not a Unix socket connection")
	}

	rawConn, err := unixConn.SyscallConn()
	if err != nil {
		return nil, fmt.Errorf("failed to get raw connection: %w", err)
	}

	var secContext string
	var secErr error

	err = rawConn.Control(func(fd uintptr) {
		secContext, secErr = unix.GetsockoptString(int(fd), unix.SOL_SOCKET, unix.SO_PEERSEC)
	})

	if err != nil {
		return nil, fmt.Errorf("failed to control socket: %w", err)
	}
	if secErr != nil {
		return nil, fmt.Errorf("failed to get peer security context: %w", secErr)
	}

	// Remove null terminator if present
	secContext = strings.TrimRight(secContext, "\x00")

	return parseSELinuxContext(secContext)
}

// parseSELinuxContext parses a raw SELinux context string
// Format: user:role:type:level (e.g., "system_u:system_r:container_t:s0:c1,c2")
func parseSELinuxContext(raw string) (*SELinuxContext, error) {
	if raw == "" {
		return nil, fmt.Errorf("empty security context")
	}

	parts := strings.SplitN(raw, ":", 4)
	if len(parts) < 3 {
		return nil, fmt.Errorf("invalid SELinux context format: %s", raw)
	}

	ctx := &SELinuxContext{
		User: parts[0],
		Role: parts[1],
		Type: parts[2],
		Raw:  raw,
	}

	if len(parts) >= 4 {
		ctx.Level = parts[3]
	}

	return ctx, nil
}

// peerSecFromContext retrieves SELinux context from request context
func peerSecFromContext(ctx context.Context) *SELinuxContext {
	if sec, ok := ctx.Value(peerSecContextKey{}).(*SELinuxContext); ok {
		return sec
	}
	return nil
}

// connContextWithPeerSec creates a ConnContext function that captures SELinux context
func connContextWithPeerSec(ctx context.Context, conn net.Conn) context.Context {
	sec, err := getPeerSecContext(conn)
	if err != nil {
		slog.Debug("peer_sec.extract_failed", "error", err)
		return ctx
	}
	slog.Debug("peer_sec.extracted",
		"type", sec.Type,
		"user", sec.User,
		"role", sec.Role,
		"level", sec.Level,
		"raw", sec.Raw,
	)
	return context.WithValue(ctx, peerSecContextKey{}, sec)
}

// peerSecMiddleware enforces SELinux type matching for API access
// Only processes with allowed SELinux types can access the API
func peerSecMiddleware(allowedTypes []string) func(http.Handler) http.Handler {
	// Build lookup set for O(1) matching
	allowed := make(map[string]bool, len(allowedTypes))
	for _, t := range allowedTypes {
		allowed[t] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip enforcement if not in production (NOMAD_ALLOC_DIR not set)
			if os.Getenv("NOMAD_ALLOC_DIR") == "" {
				next.ServeHTTP(w, r)
				return
			}

			sec := peerSecFromContext(r.Context())
			if sec == nil {
				slog.Warn("peer_sec.missing", "path", r.URL.Path, "method", r.Method)
				http.Error(w, `{"error":"security_context_required","message":"SELinux security context not available"}`, http.StatusForbidden)
				return
			}

			if !allowed[sec.Type] {
				slog.Warn("peer_sec.type_denied",
					"path", r.URL.Path,
					"method", r.Method,
					"type", sec.Type,
					"allowed_types", allowedTypes,
					"raw", sec.Raw,
				)
				http.Error(w, `{"error":"unauthorized_context","message":"SELinux type not authorized to access this API"}`, http.StatusForbidden)
				return
			}

			slog.Debug("peer_sec.allowed", "path", r.URL.Path, "type", sec.Type)
			next.ServeHTTP(w, r)
		})
	}
}

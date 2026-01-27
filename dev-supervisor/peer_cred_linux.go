//go:build linux

package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"

	"golang.org/x/sys/unix"
)

// PeerCredentials holds the credentials of the peer process from SO_PEERCRED
type PeerCredentials struct {
	PID int32
	UID uint32
	GID uint32
}

type peerCredContextKey struct{}

// getPeerCredentials extracts peer credentials using SO_PEERCRED
func getPeerCredentials(conn net.Conn) (*PeerCredentials, error) {
	unixConn, ok := conn.(*net.UnixConn)
	if !ok {
		return nil, fmt.Errorf("not a Unix socket connection")
	}

	rawConn, err := unixConn.SyscallConn()
	if err != nil {
		return nil, fmt.Errorf("failed to get raw connection: %w", err)
	}

	var cred *unix.Ucred
	var credErr error

	err = rawConn.Control(func(fd uintptr) {
		cred, credErr = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
	})

	if err != nil {
		return nil, fmt.Errorf("failed to control socket: %w", err)
	}
	if credErr != nil {
		return nil, fmt.Errorf("failed to get peer credentials: %w", credErr)
	}

	return &PeerCredentials{
		PID: cred.Pid,
		UID: cred.Uid,
		GID: cred.Gid,
	}, nil
}

// peerCredFromContext retrieves peer credentials from request context
func peerCredFromContext(ctx context.Context) *PeerCredentials {
	if cred, ok := ctx.Value(peerCredContextKey{}).(*PeerCredentials); ok {
		return cred
	}
	return nil
}

// connContextWithPeerCred creates a ConnContext function that captures peer credentials
func connContextWithPeerCred(ctx context.Context, conn net.Conn) context.Context {
	cred, err := getPeerCredentials(conn)
	if err != nil {
		slog.Debug("peer_cred.extract_failed", "error", err)
		return ctx
	}
	slog.Debug("peer_cred.extracted", "pid", cred.PID, "uid", cred.UID, "gid", cred.GID)
	return context.WithValue(ctx, peerCredContextKey{}, cred)
}

// peerCredPID1Middleware enforces that only PID 1 can access the API
func peerCredPID1Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("NOMAD_ALLOC_DIR") == "" {
			next.ServeHTTP(w, r)
			return
		}

		cred := peerCredFromContext(r.Context())
		if cred == nil {
			slog.Warn("peer_cred.missing", "path", r.URL.Path, "method", r.Method)
			http.Error(w, `{"error":"peer_credentials_required","message":"Unix socket peer credentials not available"}`, http.StatusForbidden)
			return
		}

		if cred.PID != 1 {
			slog.Warn("peer_cred.pid_denied",
				"path", r.URL.Path,
				"method", r.Method,
				"pid", cred.PID,
				"uid", cred.UID,
				"gid", cred.GID,
			)
			http.Error(w, `{"error":"unauthorized_process","message":"Only PID 1 is allowed to access this API"}`, http.StatusForbidden)
			return
		}

		slog.Debug("peer_cred.allowed", "path", r.URL.Path, "pid", cred.PID)
		next.ServeHTTP(w, r)
	})
}

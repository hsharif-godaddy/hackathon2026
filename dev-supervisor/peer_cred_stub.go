//go:build !linux

package main

import (
	"context"
	"net"
	"net/http"
)

// PeerCredentials holds the credentials of the peer process
type PeerCredentials struct {
	PID int32
	UID uint32
	GID uint32
}

// connContextWithPeerCred is a no-op on non-Linux platforms
func connContextWithPeerCred(ctx context.Context, _ net.Conn) context.Context {
	return ctx
}

// peerCredPID1Middleware is a pass-through on non-Linux platforms
func peerCredPID1Middleware(next http.Handler) http.Handler {
	return next
}

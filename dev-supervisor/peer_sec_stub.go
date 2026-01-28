//go:build !linux

package main

import (
	"context"
	"net"
	"net/http"
)

// SELinuxContext represents a parsed SELinux security context
type SELinuxContext struct {
	User  string
	Role  string
	Type  string
	Level string
	Raw   string
}

// connContextWithPeerSec is a no-op on non-Linux platforms
func connContextWithPeerSec(ctx context.Context, _ net.Conn) context.Context {
	return ctx
}

// peerSecMiddleware is a pass-through on non-Linux platforms
func peerSecMiddleware(_ []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return next
	}
}

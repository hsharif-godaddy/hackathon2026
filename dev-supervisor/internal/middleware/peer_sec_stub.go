//go:build !linux

package middleware

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

// ConnContextWithPeerSec is a no-op on non-Linux platforms
func ConnContextWithPeerSec(ctx context.Context, _ net.Conn) context.Context {
	return ctx
}

// PeerSec is a pass-through on non-Linux platforms
func PeerSec(_ []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return next
	}
}

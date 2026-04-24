// Package auth provides a singleton GDAuth client and HTTP middleware for authentication.
package auth

import (
	"fmt"
	"log/slog"
	"strings"
	"sync"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
)

// Client wraps the gd-auth-lib GDAuth client with configuration metadata.
// Use GetClient() to obtain the singleton instance.
type Client struct {
	GDAuth  *gdauth.GDAuth
	SSOHost string
}

var (
	clientOnce     sync.Once
	clientInstance *Client
	clientErr      error
)

// InitClient initializes the singleton GDAuth client with the given SSO host.
// Must be called once at startup before GetClient().
// Subsequent calls are no-ops (singleton pattern).
// If ssoHost lacks a protocol, "https://" is prepended automatically.
func InitClient(ssoHost string) error {
	clientOnce.Do(func() {
		gdClient, err := gdauth.New(
			gdauth.WithApp("budget-service"),
			gdauth.WithClient("budget-service.api.int.godaddy.com"),
			gdauth.WithPCPID("8606"),
			gdauth.WithTestMode(false),
		)
		if err != nil {
			clientErr = fmt.Errorf("gd-auth-lib init failed: %w", err)
			return
		}

		// Ensure ssoHost has a protocol prefix
		normalizedHost := ssoHost
		if !strings.HasPrefix(ssoHost, "https://") && !strings.HasPrefix(ssoHost, "http://") {
			normalizedHost = "https://" + ssoHost
		}

		clientInstance = &Client{
			GDAuth:  gdClient,
			SSOHost: normalizedHost,
		}
		slog.Info("auth.client.init", "ssoHost", normalizedHost)
	})
	return clientErr
}

// GetClient returns the singleton GDAuth client.
// Returns nil if InitClient was not called or failed.
func GetClient() *Client {
	return clientInstance
}

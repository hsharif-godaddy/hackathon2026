// Package stripe defines the narrow Stripe surface stripe-service depends on
// and provides concrete implementations of it.
package stripe

import "context"

// CreateSandboxInput is what the agent-facing POST /v1/sandboxes handler
// forwards to the Stripe client.
type CreateSandboxInput struct {
	AppID   string
	Email   string
	Country string
}

// Sandbox is what Stripe's v2.core.claimableSandboxes.create returns, reduced
// to the fields stripe-service cares about. This is a protocol DTO — the
// persistence shape (with ClaimStatus, timestamps, etc.) lives in
// internal/store.Sandbox.
type Sandbox struct {
	SandboxID      string
	AccountID      string
	PublishableKey string
	SecretKey      string
	MCPKey         string
	ClaimURL       string
}

// Client is the narrow surface agent-facing handlers depend on.
type Client interface {
	CreateClaimableSandbox(ctx context.Context, in CreateSandboxInput) (Sandbox, error)
}

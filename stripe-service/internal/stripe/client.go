// Package stripe defines the narrow Stripe surface stripe-service depends on
// and provides concrete implementations of it.
package stripe

import "context"

// CreateSandboxInput is what the api handler forwards to the Stripe client.
//
// PrefillEmail is resolved server-side from the GoDaddy PIE customer API using
// the CustomerId claim — never accepted from the caller directly, to prevent a
// malicious user from specifying a victim's address and triggering Stripe's
// pre-expiry reminder to that address (see postSandboxes). A failed PIE lookup
// is fatal: postSandboxes returns 400 MISSING_CUSTOMER_EMAIL and Stripe is
// never called. There is no platform-address fallback.
//
// PrefillCountry comes from the caller (the agent asks the user for their
// country) — it's harmless form prefill with no notification vector.
//
// Stripe's preview API requires both despite the docs listing them as optional
// (returns 400 invalid_fields if either is absent).
type CreateSandboxInput struct {
	AppID          string
	PrefillEmail   string // resolved server-side via PIE; see postSandboxes
	PrefillCountry string // user-provided via agent
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

// MintLiveAPIKeysInput carries the merchant context for live-key minting.
// IdempotencyKey is the trigger event_id (Stripe webhook) so retries of the
// same delivery collapse into one mint at the API boundary.
type MintLiveAPIKeysInput struct {
	// OwnerAccount is the merchant's live-mode acct_*. Surfaced from
	// changes.after.owner_details.account on the
	// v2.core.claimable_sandbox.updated event after the merchant completes
	// the Airo Stripe App install. Empty values are rejected.
	OwnerAccount string
	// IdempotencyKey scopes Stripe-side dedup of the apiKeys.create calls.
	// The webhook event_id is the right choice for webhook-triggered
	// mints. Empty values are rejected.
	IdempotencyKey string
}

// LiveAPIKeys are the plaintext credentials returned after JWE decryption (or
// fake substitution). SecretKey and PublishableKey are populated on success;
// empty values for either represent a contract violation. MCPKey may be empty
// in live mode — Stripe's v2.iam.api_keys does not yet accept type=mcp_key in
// live (see real.go MintLiveAPIKeys mcp_key.skipped block). Callers must
// branch on `MCPKey == ""` rather than dereference unconditionally.
type LiveAPIKeys struct {
	SecretKey      string // sk_live_*
	PublishableKey string // pk_live_*
	MCPKey         string // ek_live_*; empty when Stripe rejects mcp_key in live (see real.go)
}

// Client is the narrow surface agent-facing and webhook handlers depend on.
//
// Implementations:
//   - RealClient: hits Stripe's v2 preview API, JWE-decrypts secret/MCP via
//     KMS+AES-256-GCM. Used when STRIPE_CLIENT=real and ENVIRONMENT != local.
//   - FakeClient: returns deterministic *_fake_* values. Used by tests, by
//     ENVIRONMENT=local, and by deploys not yet pointed at real Stripe.
type Client interface {
	CreateClaimableSandbox(ctx context.Context, in CreateSandboxInput) (Sandbox, error)

	// MintLiveAPIKeys runs v2.iam.api_keys.create calls scoped to the
	// merchant's account, JWE-decrypts the secret response, and returns
	// plaintext keys ready to push into the alloc env via hosting. The
	// publishable_key call returns plaintext-by-design at the protocol
	// level so it skips the JWE pipeline. The mcp_key call is conditional:
	// Stripe's v2.iam.api_keys does not yet accept type=mcp_key in live
	// mode, so RealClient skips it and returns LiveAPIKeys.MCPKey == ""
	// (FakeClient still returns a fake mcp_live for round-trip coverage).
	// Callers must branch on `MCPKey == ""` rather than dereference
	// unconditionally.
	MintLiveAPIKeys(ctx context.Context, in MintLiveAPIKeysInput) (LiveAPIKeys, error)
}

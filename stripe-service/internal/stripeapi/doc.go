// Package stripeapi is the outbound HTTP client for Stripe's v2 preview
// APIs that stripe-service depends on:
//
//   - POST /v2/core/claimable_sandboxes
//     (https://docs.stripe.com/api/v2/claimable-sandboxes/create) —
//     test-mode sandbox provisioning, called from POST /v1/sandboxes.
//
//   - POST /v2/iam/api_keys
//     (https://docs.stripe.com/api/v2/api-keys/create) —
//     live-mode secret/publishable/MCP key minting, called from the
//     sandbox_details_owner_account_updated webhook handler.
//
// Both endpoints are private-preview and subject to schema churn — the
// Stripe-Version header is configurable so version bumps don't require
// code changes. Authentication is a static Bearer token (the platform
// sk_live_* / sk_test_* loaded from Secrets Manager at process start).
//
// JWE responses (returned by api_keys for type=secret_key / mcp_key) are
// surfaced as raw bytes; decryption belongs in a separate package
// (internal/jwedecrypt, future PR) so the boundaries between HTTP I/O
// and crypto stay clean.
//
// See STRIPE_INTEGRATION_PLAN.md §4.2.1 for request/response shapes and
// the JWE structure, and §6.1 for the sequence diagram showing how this
// client is called from POST /v1/sandboxes.
package stripeapi

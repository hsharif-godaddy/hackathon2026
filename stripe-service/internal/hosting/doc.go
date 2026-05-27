// Package hosting is the outbound client for the mhp-core hosting service's
// secrets API (mhp-core/backends/hosting). It replaces the earlier mhp-airo
// path that used a (subscriptionId, systemId, appId) triple-keyed URL.
//
// stripe-service uses it to push Stripe-issued credentials (STRIPE_SECRET_KEY /
// STRIPE_PUBLISHABLE_KEY / STRIPE_MCP_KEY) into a customer app's alloc env
// and to trigger the workflow that delivers and reloads them. One method
// covers the surface we need: UpdateSecrets — a single bulk
// POST /hosting/v1/apps/:appId/secrets that carries up to N upsert/delete
// operations and a workflowName that triggers the reload pipeline server-side.
//
// Auth is pluggable via AuthProvider. In production we use AwsIamAuth backed
// by gd-auth-lib's AWS-IAM JWT minter; in local dev against local-control-plane
// (where AUTH_TYPE=none) we use NoopAuth.
//
// The hosting endpoint is appId-only — no subscription/system tuple in the
// path — so this client never needs to resolve the (subscriptionId, systemId)
// pair the previous airo-direct integration required. Per-key delivery
// targeting (agent vs preview vs publish) is carried in each operation's
// Protected/Variants flags rather than in the URL.
package hosting

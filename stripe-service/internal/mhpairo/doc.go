// Package mhpairo is the outbound client for the mhp-airo control-plane API.
//
// stripe-service uses it to push Stripe-issued credentials (STRIPE_SECRET_KEY /
// STRIPE_PUBLISHABLE_KEY / STRIPE_MCP_KEY) into a customer app's alloc env,
// and to trigger the reload that makes them take effect. Three methods cover
// the surface we need: UpdateSecrets, UpdateApp, ReloadApp.
//
// Auth is pluggable via AuthProvider. In production we use AwsIamAuth backed
// by gd-auth-lib's AWS-IAM JWT minter; in local dev against local-control-plane
// (where AUTH_TYPE=none) we use NoopAuth.
//
// The client is deliberately callable-agnostic: it takes the full
// (subscriptionId, systemId, appId) triple on every call. mhp-airo has no
// appId-only endpoint and the BFF's "me"-based resolution needs a customer
// JWT that stripe-service doesn't have. Whatever caller owns the appId is
// expected to carry the triple alongside.
package mhpairo

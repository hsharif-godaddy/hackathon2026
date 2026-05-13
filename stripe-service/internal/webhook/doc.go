// Package webhook verifies the HMAC-SHA256 signatures Stripe attaches to
// inbound webhooks via the Stripe-Signature header.
//
// Algorithm reference: https://docs.stripe.com/webhooks#verify-manually
//
// We hand-roll instead of pulling in stripe-go because the algorithm is
// short and the SDK would otherwise be unused (this service has no other
// Stripe code at the time this package landed). Event-payload parsing is
// not in scope here — the handler decodes JSON itself once a signature
// passes Verify.
package webhook

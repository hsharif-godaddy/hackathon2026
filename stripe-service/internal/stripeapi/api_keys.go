package stripeapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
)

// APIKeyType is the Stripe-defined enum for v2.iam.api_keys.
type APIKeyType string

const (
	// APIKeyTypeSecret mints a live-mode secret key (sk_live_*).
	// Returned as a JWE compact serialization.
	APIKeyTypeSecret APIKeyType = "secret_key"

	// APIKeyTypePublishable mints a live-mode publishable key (pk_live_*).
	// Returned as plaintext (publishable keys are safe to expose).
	APIKeyTypePublishable APIKeyType = "publishable_key"

	// APIKeyTypeMCP mints a live-mode MCP key (ek_live_*).
	// Phase 3 — see STRIPE_INTEGRATION_PLAN.md §4.4.6.
	// Returned as a JWE compact serialization (assumed; gated on Stripe
	// CS confirmation per integration-plan question 9).
	APIKeyTypeMCP APIKeyType = "mcp_key"
)

// CreateAPIKeyRequest is the body of POST /v2/iam/api_keys. PublicKey
// must be set for secret_key and mcp_key requests, and omitted for
// publishable_key requests (Stripe rejects requests carrying it for
// publishable keys).
type CreateAPIKeyRequest struct {
	Type      APIKeyType `json:"type"`
	Name      string     `json:"name,omitempty"`
	Note      string     `json:"note,omitempty"`
	PublicKey *PublicKey `json:"public_key,omitempty"`
}

// PublicKey carries the RSA PEM Stripe uses to wrap the CEK in the JWE
// response. Sent inline on every secret-key / mcp-key creation; Stripe
// does not pre-register the key.
type PublicKey struct {
	PEMKey PEMKey `json:"pem_key"`
}

// PEMKey is the inner shape Stripe expects.
type PEMKey struct {
	// Data is the full PEM string with newlines preserved
	// (BEGIN PUBLIC KEY ... END PUBLIC KEY).
	Data string `json:"data"`
	// Algorithm is "RSA" today; widened later if Stripe supports more.
	Algorithm string `json:"algorithm"`
}

// CreateAPIKeyResponse covers all three response shapes:
//
//   - For type=publishable_key, PublishableKey.Value is the plaintext
//     pk_live_* and SecretKey/MCPKey are nil.
//   - For type=secret_key, SecretKey.EncryptedSecret.Ciphertext holds
//     the JWE compact serialization for the sk_live_*.
//   - For type=mcp_key, MCPKey.EncryptedSecret.Ciphertext holds the JWE
//     for the ek_live_*.
type CreateAPIKeyResponse struct {
	ID             string              `json:"id"`
	Type           APIKeyType          `json:"type"`
	Name           string              `json:"name,omitempty"`
	PublishableKey PublishableKeyValue `json:"publishable_key,omitempty"`
	SecretKey      *EncryptedField     `json:"secret_key,omitempty"`
	MCPKey         *EncryptedField     `json:"mcp_key,omitempty"`
}

// PublishableKeyValue holds the plaintext publishable key from Stripe's
// apiKeys.create response. The wire shape varies across Stripe's preview
// API versions:
//
//   - Bare string: `"publishable_key": "pk_live_..."`. Matches plan
//     §4.2.1's documented design and the original test fixture.
//   - Wrapped object: `"publishable_key": {"key": "pk_live_..."}` (or a
//     similar inner field). Observed in live mode against API version
//     2026-03-25.dahlia (2026-05-28).
//
// Custom UnmarshalJSON accepts both shapes so a future schema rotation
// doesn't break us. Unknown shapes return an error that includes a
// (truncated) hex-safe view of the raw bytes — that's the diagnostic
// breadcrumb for adding a new field name to the lookup table.
type PublishableKeyValue struct {
	Value string
}

// publishableKeyInnerFields lists the inner field names we'll try when
// the response shape is an object. Order matters only for shape-overlap
// edge cases — Stripe shouldn't emit a wrapper with multiple of these
// populated, but if it does, the first match wins.
//
// Observed shapes (Stripe API version 2026-03-25.dahlia, live mode,
// 2026-05-28): `{"token": "pk_live_..."}`. Earlier versions are
// documented as bare strings (plan §4.2.1) — both are accepted.
var publishableKeyInnerFields = []string{"token", "key", "value", "publishable_key", "plaintext"}

// UnmarshalJSON parses either a JSON string or a single-key object
// wrapping the plaintext key. See PublishableKeyValue for the rationale.
//
// On success, emits a debug log naming the matched shape ("bare_string"
// or "object[<fieldname>]"). Useful as an early-warning signal for
// future schema rotations — if the matched shape changes between
// deploys, the log diff surfaces it before any other symptom does.
func (p *PublishableKeyValue) UnmarshalJSON(data []byte) error {
	// Empty / null → leave Value as zero. The validation in CreateAPIKey
	// catches a missing field per response Type, not here.
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	// Try bare string shape (plan §4.2.1's documented form).
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		p.Value = s
		slog.Debug("stripeapi.publishable_key.shape_detected", "shape", "bare_string")
		return nil
	}
	// Try object shape with one of the known inner field names.
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(data, &obj); err != nil {
		return fmt.Errorf("publishable_key: not a string or object (raw: %s): %w", truncateForLog(data), err)
	}
	for _, field := range publishableKeyInnerFields {
		raw, ok := obj[field]
		if !ok {
			continue
		}
		var inner string
		if err := json.Unmarshal(raw, &inner); err != nil {
			continue
		}
		if inner != "" {
			p.Value = inner
			slog.Debug("stripeapi.publishable_key.shape_detected", "shape", "object", "field", field)
			return nil
		}
	}
	return fmt.Errorf(
		"publishable_key: object has no known plaintext field (tried %v); raw=%s",
		publishableKeyInnerFields, truncateForLog(data),
	)
}

// truncateForLog clips a JSON byte slice for inclusion in error messages
// without leaking unbounded payload to logs. Pulls the first 200 bytes,
// appends an ellipsis when truncated. Hex-safe by virtue of the source
// being JSON; control chars are rare and the truncation is short.
func truncateForLog(data []byte) string {
	const maxLen = 200
	if len(data) <= maxLen {
		return string(data)
	}
	return string(data[:maxLen]) + "...(truncated)"
}

// EncryptedField wraps the JWE for the secret-bearing response shapes.
type EncryptedField struct {
	EncryptedSecret EncryptedSecret `json:"encrypted_secret"`
}

// EncryptedSecret carries the JWE compact serialization. Decryption
// (RSA-OAEP CEK unwrap + AES-256-GCM content decrypt) is the
// responsibility of internal/jwedecrypt (future PR).
type EncryptedSecret struct {
	// Ciphertext is the five-segment JWE: header.cek.iv.ct.tag.
	Ciphertext string `json:"ciphertext"`
}

// CreateAPIKey calls POST /v2/iam/api_keys.
//
// stripeContext must be the merchant's account_id (acct_*) — the
// integration always scopes this call cross-account, so an empty value
// is rejected.
//
// idempotencyKey must be non-empty. For webhook-triggered mints
// (sandbox_details_owner_account_updated, api_key.rotated), the Stripe
// event_id is the right choice: replays of the same webhook produce
// the same idempotent call.
func (c *Client) CreateAPIKey(
	ctx context.Context,
	idempotencyKey string,
	stripeContext string,
	req CreateAPIKeyRequest,
) (*CreateAPIKeyResponse, error) {
	if idempotencyKey == "" {
		return nil, errors.New("stripeapi: CreateAPIKey: idempotencyKey is required")
	}
	if stripeContext == "" {
		return nil, errors.New("stripeapi: CreateAPIKey: stripeContext (merchant account_id) is required")
	}
	switch req.Type {
	case APIKeyTypeSecret, APIKeyTypePublishable, APIKeyTypeMCP:
		// ok
	default:
		return nil, fmt.Errorf("stripeapi: CreateAPIKey: invalid type %q", req.Type)
	}
	if (req.Type == APIKeyTypeSecret || req.Type == APIKeyTypeMCP) && req.PublicKey == nil {
		return nil, fmt.Errorf("stripeapi: CreateAPIKey: type %q requires PublicKey", req.Type)
	}
	if req.Type == APIKeyTypePublishable && req.PublicKey != nil {
		return nil, errors.New("stripeapi: CreateAPIKey: type publishable_key must not include PublicKey")
	}

	rawResp, err := c.do(
		ctx,
		http.MethodPost,
		"/v2/iam/api_keys",
		requestHeaders{idempotencyKey: idempotencyKey, stripeContext: stripeContext},
		req,
	)
	if err != nil {
		return nil, err
	}

	var out CreateAPIKeyResponse
	if err := json.Unmarshal(rawResp, &out); err != nil {
		// On decode failure, log the raw bytes (truncated) so the next
		// schema rotation is diagnosable from one log line. Stripe
		// responses contain JWE ciphertext or plaintext-publishable-key
		// fragments — neither leaks plaintext secret keys (those are
		// JWE-encrypted in the response), so logging is safe.
		slog.Error("stripeapi.create_api_key.decode_failed",
			"type", req.Type,
			"rawBody", truncateForLog(rawResp),
			"error", err,
		)
		return nil, fmt.Errorf("stripeapi CreateAPIKey: decode response: %w", err)
	}
	// Defensive: a 2xx that decodes to an all-zero (or wrong-shaped)
	// struct would silently propagate empty credentials downstream.
	// The response is a tagged union — Type discriminates which inner
	// field carries the secret material — so the invariant check is
	// per-type. Catches schema drift and contract violations at the
	// boundary instead of three calls deep.
	switch out.Type {
	case APIKeyTypePublishable:
		if out.PublishableKey.Value == "" {
			return nil, fmt.Errorf("stripeapi CreateAPIKey: response missing publishable_key for type=publishable_key")
		}
	case APIKeyTypeSecret:
		if out.SecretKey == nil || out.SecretKey.EncryptedSecret.Ciphertext == "" {
			return nil, fmt.Errorf("stripeapi CreateAPIKey: response missing secret_key.encrypted_secret.ciphertext for type=secret_key")
		}
	case APIKeyTypeMCP:
		if out.MCPKey == nil || out.MCPKey.EncryptedSecret.Ciphertext == "" {
			return nil, fmt.Errorf("stripeapi CreateAPIKey: response missing mcp_key.encrypted_secret.ciphertext for type=mcp_key")
		}
	default:
		return nil, fmt.Errorf("stripeapi CreateAPIKey: response carries unexpected type %q", out.Type)
	}
	return &out, nil
}

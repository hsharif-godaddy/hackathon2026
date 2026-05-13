package stripeapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
//   - For type=publishable_key, PublishableKey is the plaintext
//     pk_live_* and SecretKey/MCPKey are nil.
//   - For type=secret_key, SecretKey.EncryptedSecret.Ciphertext holds
//     the JWE compact serialization for the sk_live_*.
//   - For type=mcp_key, MCPKey.EncryptedSecret.Ciphertext holds the JWE
//     for the ek_live_*.
type CreateAPIKeyResponse struct {
	ID             string          `json:"id"`
	Type           APIKeyType      `json:"type"`
	Name           string          `json:"name,omitempty"`
	PublishableKey string          `json:"publishable_key,omitempty"`
	SecretKey      *EncryptedField `json:"secret_key,omitempty"`
	MCPKey         *EncryptedField `json:"mcp_key,omitempty"`
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
		if out.PublishableKey == "" {
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

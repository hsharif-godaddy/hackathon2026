package stripe

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ParsePlatformKey normalizes the value loaded from
// ${env}-airo-stripe-platform-key into the raw sk_test_* / sk_live_*
// string stripeapi.New needs.
//
// The CDK stack provisions the secret with a placeholder ("populated
// manually" per cdk/lib/airo-stripe-service-stack.ts); operators can
// either drop in the raw key as plaintext, or paste a JSON-wrapped
// form ({"apiKey":"sk_test_..."}). Accept both shapes so a misformatted
// or unreplaced secret crashes the process at startup with a clear
// error instead of silently 401-ing every Stripe call.
func ParsePlatformKey(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("stripe platform key: value is empty")
	}

	secret := raw
	if strings.HasPrefix(raw, "{") {
		// Try common field names. Most CDK templates use "apiKey"; some
		// teams use "secretKey" or "key". First non-empty field wins.
		var wrapped struct {
			APIKey    string `json:"apiKey"`
			SecretKey string `json:"secretKey"`
			Key       string `json:"key"`
		}
		if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
			return "", fmt.Errorf("stripe platform key: parse JSON wrapper: %w", err)
		}
		secret = firstNonEmpty(wrapped.APIKey, wrapped.SecretKey, wrapped.Key)
		if secret == "" {
			return "", errors.New(`stripe platform key: JSON wrapper is missing "apiKey" / "secretKey" / "key" field`)
		}
		secret = strings.TrimSpace(secret)
	}

	if !strings.HasPrefix(secret, "sk_test_") && !strings.HasPrefix(secret, "sk_live_") {
		return "", errors.New("stripe platform key: must start with sk_test_ or sk_live_")
	}
	return secret, nil
}

// firstNonEmpty returns the first input whose trimmed value is
// non-empty. Trim-aware so a JSON wrapper that has `"apiKey": "   "`
// doesn't shadow a populated `"secretKey"` — the diagnostic would
// otherwise blame the wrong field.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

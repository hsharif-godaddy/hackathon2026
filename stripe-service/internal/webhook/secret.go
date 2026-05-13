package webhook

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ParseSigningSecret normalizes the value loaded from
// ${env}-airo-stripe-webhook-signing into the raw whsec_* string the
// verifier needs.
//
// CDK provisions the secret with secretStringTemplate
// `{"signingSecret":"REPLACE_ME"}` (cdk/lib/airo-stripe-service-stack.ts),
// but operators rotating it manually sometimes overwrite the entry with
// raw plaintext. Accepting both shapes avoids a class of "service runs
// fine but 401s every Stripe delivery" failures: instead, a misformatted
// or unreplaced secret crashes the process at startup with a clear error.
func ParseSigningSecret(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("webhook signing secret: value is empty")
	}

	secret := raw
	if strings.HasPrefix(raw, "{") {
		var wrapped struct {
			SigningSecret string `json:"signingSecret"`
		}
		if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
			return "", fmt.Errorf("webhook signing secret: parse JSON wrapper: %w", err)
		}
		if wrapped.SigningSecret == "" {
			return "", errors.New(`webhook signing secret: JSON wrapper is missing "signingSecret" field`)
		}
		secret = strings.TrimSpace(wrapped.SigningSecret)
	}

	if !strings.HasPrefix(secret, "whsec_") {
		return "", errors.New("webhook signing secret: must start with whsec_ (placeholder not yet replaced?)")
	}
	return secret, nil
}

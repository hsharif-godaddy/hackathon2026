package config

import (
	"strings"
	"testing"
)

func TestLoadWebhookOAuthRequiresPairedTokenURLAndClientID(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")

	tests := []struct {
		name   string
		url    string
		client string
	}{
		{"token_url_without_client_id", "https://example.com/token", ""},
		{"client_id_without_token_url", "", "some-client-id"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("WEBHOOK_OAUTH_TOKEN_URL", tt.url)
			t.Setenv("WEBHOOK_OAUTH_CLIENT_ID", tt.client)
			_, err := Load()
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), "WEBHOOK_OAUTH_TOKEN_URL") {
				t.Fatalf("error %q should mention WEBHOOK_OAUTH_TOKEN_URL", err.Error())
			}
		})
	}
}

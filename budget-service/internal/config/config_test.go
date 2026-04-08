package config

import (
	"os"
	"testing"
)

func TestLoad_WebhookSecret(t *testing.T) {
	// Save and restore environment
	origSecret := os.Getenv("WEBHOOK_SECRET")
	origSSOHost := os.Getenv("SSO_HOST")
	origLocalAuth := os.Getenv("LOCAL_AUTH_DISABLE")
	defer func() {
		os.Setenv("WEBHOOK_SECRET", origSecret)
		os.Setenv("SSO_HOST", origSSOHost)
		os.Setenv("LOCAL_AUTH_DISABLE", origLocalAuth)
	}()

	// Set required env vars for Load() to succeed
	os.Setenv("LOCAL_AUTH_DISABLE", "true")

	tests := []struct {
		name     string
		envValue string
		want     string
	}{
		{
			name:     "reads secret from env",
			envValue: "my-webhook-secret",
			want:     "my-webhook-secret",
		},
		{
			name:     "trims whitespace",
			envValue: "  secret-with-spaces  ",
			want:     "secret-with-spaces",
		},
		{
			name:     "empty when not set",
			envValue: "",
			want:     "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Setenv("WEBHOOK_SECRET", tt.envValue)
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			if cfg.WebhookSecret != tt.want {
				t.Errorf("WebhookSecret = %q, want %q", cfg.WebhookSecret, tt.want)
			}
		})
	}
}

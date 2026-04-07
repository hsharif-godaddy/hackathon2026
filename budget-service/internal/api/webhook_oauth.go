package api

import (
	"context"
	"strings"

	"github.com/gdcorp-identity/authz-lib-go/pkg/oauth"
)

// WebhookOAuthClient mints access tokens for outbound report webhook HTTP requests.
type WebhookOAuthClient interface {
	GetAccessToken(ctx context.Context, scopes ...string) (*oauth.TokenResponse, error)
}

func webhookAuthorizationValue(tr *oauth.TokenResponse) string {
	if tr == nil || strings.TrimSpace(tr.AccessToken) == "" {
		return ""
	}
	tt := strings.TrimSpace(tr.TokenType)
	if tt == "" {
		tt = "Bearer"
	}
	at := strings.TrimSpace(tr.AccessToken)
	return tt + " " + at
}

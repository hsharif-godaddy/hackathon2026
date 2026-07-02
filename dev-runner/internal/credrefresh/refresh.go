package credrefresh

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ssooidc"
)

// TokenRefresher attempts a silent OIDC token refresh for a profile.
// Returns the new TTL on success, or an error if refresh is not possible.
type TokenRefresher interface {
	Refresh(ctx context.Context, profile string) (time.Duration, error)
}

// OIDCRefresher refreshes SSO tokens using the OIDC CreateToken API with a refresh token.
type OIDCRefresher struct {
	homeDir string
}

// NewOIDCRefresher creates a refresher. Pass homeDir="" for production.
func NewOIDCRefresher(homeDir string) *OIDCRefresher {
	return &OIDCRefresher{homeDir: homeDir}
}

func (r *OIDCRefresher) Refresh(ctx context.Context, profile string) (time.Duration, error) {
	cache, cachePath, err := ReadTokenCache(profile, r.homeDir)
	if err != nil {
		return 0, fmt.Errorf("reading token cache: %w", err)
	}

	if cache.RefreshToken() == "" {
		return 0, fmt.Errorf("no refresh token in cache (profile %q uses legacy SSO config without sso-session)", profile)
	}

	if cache.ClientID() == "" || cache.ClientSecret() == "" {
		return 0, fmt.Errorf("missing clientId/clientSecret in cache for profile %q", profile)
	}

	_, ssoRegion, err := ResolveSSO(profile, r.homeDir)
	if err != nil {
		return 0, fmt.Errorf("resolving SSO region: %w", err)
	}
	if ssoRegion == "" {
		ssoRegion = "us-east-1"
	}

	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(ssoRegion))
	if err != nil {
		return 0, fmt.Errorf("loading AWS config for OIDC client: %w", err)
	}

	client := ssooidc.NewFromConfig(cfg)
	output, err := client.CreateToken(ctx, &ssooidc.CreateTokenInput{
		ClientId:     aws.String(cache.ClientID()),
		ClientSecret: aws.String(cache.ClientSecret()),
		GrantType:    aws.String("refresh_token"),
		RefreshToken: aws.String(cache.RefreshToken()),
	})
	if err != nil {
		return 0, fmt.Errorf("OIDC CreateToken failed: %w", err)
	}

	newExpiry := time.Now().Add(time.Duration(output.ExpiresIn) * time.Second)
	cache.SetAccessToken(aws.ToString(output.AccessToken))
	cache.SetExpiresAt(newExpiry.UTC().Format(time.RFC3339))
	if output.RefreshToken != nil {
		cache.SetRefreshToken(aws.ToString(output.RefreshToken))
	}

	if err := WriteTokenCache(cachePath, cache); err != nil {
		return 0, fmt.Errorf("writing refreshed token: %w", err)
	}

	return time.Until(newExpiry), nil
}

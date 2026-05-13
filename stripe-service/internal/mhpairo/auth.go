package mhpairo

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
)

// AuthProvider attaches an Authorization header to an outbound mhp-airo
// request. Different implementations cover different environments (AWS-IAM
// JWT in prod, no-op in local-dev against local-control-plane with
// AUTH_TYPE=none).
type AuthProvider interface {
	// ApplyAuth mutates req in place to add the credential. ctx is passed so
	// implementations that fetch a token can honor cancellation.
	ApplyAuth(ctx context.Context, req *http.Request) error

	// Name returns a short identifier suitable for structured logging.
	Name() string
}

// NoopAuth attaches no credential. Used when the receiving mhp-airo runs with
// AUTH_TYPE=none (local-control-plane, or a misconfigured deploy where we
// want to fail loud downstream rather than mint tokens the service won't
// accept anyway).
type NoopAuth struct{}

// ApplyAuth is a no-op.
func (NoopAuth) ApplyAuth(context.Context, *http.Request) error { return nil }

// Name returns the provider name.
func (NoopAuth) Name() string { return "noop" }

// tokenMinter is the subset of *gdauth.GDAuth that AwsIamAuth uses. The
// indirection lets tests plug a fake without instantiating a real gd-auth
// client (which requires loadable FFI bindings and AWS credentials).
// *gdauth.GDAuth satisfies this interface, so production wiring passes it
// through directly.
type tokenMinter interface {
	GenerateIamToken(cfg *gdauth.AwsIamTokenClientConfig) (string, error)
}

// AwsIamAuth mints an AWS-IAM JWT via gd-auth-lib and attaches it as a
// Bearer token. gd-auth-lib handles token caching and refresh internally
// (refreshMin minutes before expiry), so this type holds no cache of its
// own — repeated ApplyAuth calls are cheap.
type AwsIamAuth struct {
	minter tokenMinter
	config *gdauth.AwsIamTokenClientConfig
}

// NewAwsIamAuth constructs an AwsIamAuth from an initialized gd-auth client
// and an SSO host (protocol stripped, surrounding whitespace trimmed).
func NewAwsIamAuth(gd *gdauth.GDAuth, ssoHost string) (*AwsIamAuth, error) {
	if gd == nil {
		return nil, errors.New("mhpairo: gd-auth client is required")
	}
	host := strings.TrimSpace(ssoHost)
	host = strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://")
	if host == "" {
		return nil, errors.New("mhpairo: SSO host is required")
	}
	return &AwsIamAuth{
		minter: gd,
		config: gdauth.NewAwsIamTokenClientConfig(host),
	}, nil
}

// ApplyAuth mints (or pulls from the gd-auth-lib cache) an AWS-IAM JWT and
// sets it as a Bearer token on the request. The mint runs in a goroutine so
// a stalled GenerateIamToken is interrupted by ctx — the orphaned mint, if
// it eventually completes, populates gd-auth-lib's internal token cache and
// is reused on the next call.
func (a *AwsIamAuth) ApplyAuth(ctx context.Context, req *http.Request) error {
	type mintResult struct {
		token string
		err   error
	}
	ch := make(chan mintResult, 1)
	go func() {
		token, err := a.minter.GenerateIamToken(a.config)
		ch <- mintResult{token, err}
	}()

	select {
	case <-ctx.Done():
		return fmt.Errorf("mhpairo: mint AWS-IAM token: %w", ctx.Err())
	case r := <-ch:
		if r.err != nil {
			return fmt.Errorf("mhpairo: mint AWS-IAM token: %w", r.err)
		}
		if r.token == "" {
			return errors.New("mhpairo: gd-auth-lib returned an empty token")
		}
		req.Header.Set("Authorization", "Bearer "+r.token)
		return nil
	}
}

// Name returns the provider name.
func (*AwsIamAuth) Name() string { return "aws-iam" }

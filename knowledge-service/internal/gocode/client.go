// Package gocode provides an S2S client for making authenticated requests to GoCode.
// It generates IAM JWTs by assuming the configured gocode-access IAM role and
// exchanging AWS credentials with the GoDaddy SSO token service.
package gocode

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/gdcorp-golang/auth-client/gdtoken"
	"github.com/gdcorp-golang/auth-client/gdtoken/provider/awsiam"
)

// Client handles S2S authentication for GoCode requests.
type Client struct {
	tokenClient *gdtoken.Client
	baseURL     string
	mu          sync.Mutex
}

// New creates a GoCode S2S client. It assumes roleARN to obtain IAM credentials,
// then exchanges them for a GoDaddy IAM JWT via the SSO token service at ssoHost.
//
// roleARN should be the gocode-access role ARN (e.g. dev-airo-builder-gocode-access).
// ssoHost should be environment-specific (e.g. sso.dev-godaddy.com).
// baseURL is the GoCode API base URL.
func New(ctx context.Context, roleARN, ssoHost, baseURL string) (*Client, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("gocode.client: failed to load AWS config: %w", err)
	}

	stsClient := sts.NewFromConfig(awsCfg)

	provider := awsiam.NewProvider(
		awsiam.WithSSOHost(ssoHost),
		awsiam.WithGetCredentialsFunc(func(_ context.Context) (aws.CredentialsProvider, error) {
			return stscreds.NewAssumeRoleProvider(stsClient, roleARN), nil
		}),
	)

	return &Client{
		tokenClient: gdtoken.NewClient(gdtoken.WithProvider(provider)),
		baseURL:     baseURL,
	}, nil
}

// Token returns a GoDaddy IAM JWT formatted as "Bearer <token>", ready for
// use as an Authorization header value when calling GoCode APIs.
func (c *Client) Token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	token, err := c.tokenClient.Current(ctx)
	if err != nil {
		return "", fmt.Errorf("gocode.client: failed to get IAM JWT: %w", err)
	}

	return fmt.Sprintf("Bearer %s", token), nil
}

// BaseURL returns the configured GoCode base URL.
func (c *Client) BaseURL() string {
	return c.baseURL
}

// HTTPClient returns an *http.Client whose transport injects a fresh
// "Bearer <token>" Authorization header on every request. Use this
// when passing GoCode S2S auth to OpenAI-compatible SDK clients.
func (c *Client) HTTPClient() *http.Client {
	return &http.Client{
		Transport: &s2sTransport{tokens: c, base: http.DefaultTransport},
	}
}

// tokenProvider abstracts token retrieval for testability.
type tokenProvider interface {
	Token(ctx context.Context) (string, error)
}

// s2sTransport injects the S2S Authorization header on every outbound request.
type s2sTransport struct {
	tokens tokenProvider
	base   http.RoundTripper
}

func (t *s2sTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	token, err := t.tokens.Token(req.Context())
	if err != nil {
		return nil, fmt.Errorf("gocode.transport: failed to get token: %w", err)
	}

	req = req.Clone(req.Context())
	req.Header.Set("Authorization", token)

	return t.base.RoundTrip(req)
}

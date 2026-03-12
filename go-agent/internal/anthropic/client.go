package anthropic

import (
	"context"
	"net/http"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/ssestream"
)

const (
	DefaultModel           = sdk.ModelClaudeSonnet4_20250514
	DefaultMaxTokens int64 = 8192
)

// Client wraps the official Anthropic SDK with project-specific defaults.
type Client struct {
	inner     sdk.Client
	model     sdk.Model
	maxTokens int64
}

// Option configures a Client.
type Option func(*clientConfig)

type clientConfig struct {
	sdkOpts   []option.RequestOption
	model     sdk.Model
	maxTokens int64
}

// WithBaseURL sets a custom API base URL (for testing or proxies).
func WithBaseURL(url string) Option {
	return func(cfg *clientConfig) {
		cfg.sdkOpts = append(cfg.sdkOpts, option.WithBaseURL(url))
	}
}

// WithHTTPClient sets a custom HTTP client.
func WithHTTPClient(hc *http.Client) Option {
	return func(cfg *clientConfig) {
		cfg.sdkOpts = append(cfg.sdkOpts, option.WithHTTPClient(hc))
	}
}

// WithModel overrides the default model.
func WithModel(model sdk.Model) Option {
	return func(cfg *clientConfig) { cfg.model = model }
}

// WithMaxTokens overrides the default max_tokens.
func WithMaxTokens(n int64) Option {
	return func(cfg *clientConfig) { cfg.maxTokens = n }
}

// WithMaxRetries overrides the default retry count (default 2).
func WithMaxRetries(n int) Option {
	return func(cfg *clientConfig) {
		cfg.sdkOpts = append(cfg.sdkOpts, option.WithMaxRetries(n))
	}
}

// NewClient creates an Anthropic API client backed by the official SDK.
func NewClient(apiKey string, opts ...Option) *Client {
	cfg := &clientConfig{
		model:     DefaultModel,
		maxTokens: DefaultMaxTokens,
	}
	for _, opt := range opts {
		opt(cfg)
	}

	sdkOpts := append([]option.RequestOption{option.WithAPIKey(apiKey)}, cfg.sdkOpts...)

	return &Client{
		inner:     sdk.NewClient(sdkOpts...),
		model:     cfg.model,
		maxTokens: cfg.maxTokens,
	}
}

// CreateMessage sends a non-streaming Messages API request.
func (c *Client) CreateMessage(ctx context.Context, params sdk.MessageNewParams) (*sdk.Message, error) {
	c.applyDefaults(&params)
	return c.inner.Messages.New(ctx, params)
}

// CreateMessageStream sends a streaming Messages API request.
// The caller should iterate with stream.Next()/stream.Current() and
// close with stream.Close().
func (c *Client) CreateMessageStream(
	ctx context.Context,
	params sdk.MessageNewParams,
) *ssestream.Stream[sdk.MessageStreamEventUnion] {
	c.applyDefaults(&params)
	return c.inner.Messages.NewStreaming(ctx, params)
}

func (c *Client) applyDefaults(params *sdk.MessageNewParams) {
	if params.Model == "" {
		params.Model = c.model
	}
	if params.MaxTokens == 0 {
		params.MaxTokens = c.maxTokens
	}
}

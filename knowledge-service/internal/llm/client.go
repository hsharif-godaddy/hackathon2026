package llm

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
)

// Client provides methods for generating contextual prefixes using an LLM.
type Client struct {
	openaiClient openai.Client
	model        string
	maxTokens    int
}

// New creates a new LLM client with the provided configuration.
// If httpClient is non-nil it is used for all requests (e.g. S2S auth transport)
// and the API key is not sent. When httpClient is nil the configured API key is used.
func New(cfg *config.Config, httpClient *http.Client) *Client {
	opts := []option.RequestOption{}
	if httpClient != nil {
		opts = append(opts, option.WithHTTPClient(httpClient))
	} else {
		opts = append(opts, option.WithAPIKey(cfg.OpenAIAPIKey))
	}
	if cfg.OpenAIBaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.OpenAIBaseURL))
	}

	return &Client{
		openaiClient: openai.NewClient(opts...),
		model:        cfg.LLMModel,
		maxTokens:    cfg.LLMMaxTokens,
	}
}

// NewWithModel creates an LLM client with a specific model override.
// Used when a different model is needed (e.g. fast model for query rewriting
// vs quality model for contextual enrichment).
func NewWithModel(cfg *config.Config, httpClient *http.Client, model string) *Client {
	c := New(cfg, httpClient)
	c.model = model
	return c
}

// GenerateContext calls the LLM to produce a 1-2 sentence contextual prefix
// that situates a chunk within its parent document. The full document content
// is provided so the LLM can understand where the chunk fits in the broader context.
func (c *Client) GenerateContext(ctx context.Context, docName, fullDocument, chunkContent string) (string, error) {
	systemPrompt := `You are a search-optimization assistant. Write a short prefix that will be prepended to a chunk before embedding for vector search.

Given a document and one chunk from it, write a 2-4 sentence prefix that:
1. States the document name, which section this chunk belongs to, and what comes before/after it.
2. Lists every key entity: product names, tool names, model IDs, features, settings — be exhaustive, especially for tables.
3. Adds 3-5 alternative phrasings or questions a user might type to find this (e.g., "how do I go live", "cheapest AI model", "upload a photo").

CRITICAL RULES:
- You MUST always produce a non-empty response. Never return blank.
- For tables: list the column headers and every important value in the rows.
- For document introductions: summarize what the whole document covers and list all major sections.
- For code blocks: describe what the code does and the tools/APIs involved.
- Output ONLY the prefix text. No markdown formatting, no headers.`

	userPrompt := fmt.Sprintf("Document: %s\n\n<full_document>\n%s\n</full_document>\n\n<chunk>\n%s\n</chunk>", docName, fullDocument, chunkContent)

	resp, err := c.openaiClient.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: c.model,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		MaxTokens:   param.NewOpt(int64(c.maxTokens)),
		Temperature: param.NewOpt(0.2),
	})
	if err != nil {
		return "", fmt.Errorf("failed to generate context: %w", err)
	}

	if len(resp.Choices) == 0 {
		return "", errors.New("empty LLM response")
	}

	return resp.Choices[0].Message.Content, nil
}

// Complete sends a chat completion request with the given system and user prompts.
// Uses a small nonzero temperature (0.3) for vocabulary diversity in HyDE
// and multi-query generation while keeping outputs focused.
func (c *Client) Complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error) {
	resp, err := c.openaiClient.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: c.model,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		MaxTokens:   param.NewOpt(int64(maxTokens)),
		Temperature: param.NewOpt(0.3),
	})
	if err != nil {
		return "", fmt.Errorf("failed to complete: %w", err)
	}

	if len(resp.Choices) == 0 {
		return "", errors.New("empty LLM response")
	}

	return resp.Choices[0].Message.Content, nil
}

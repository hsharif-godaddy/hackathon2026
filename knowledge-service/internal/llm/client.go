package llm

import (
	"context"
	"fmt"

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
func New(cfg *config.Config) *Client {
	opts := []option.RequestOption{
		option.WithAPIKey(cfg.OpenAIAPIKey),
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

// GenerateContext calls the LLM to produce a 1-2 sentence contextual prefix
// that situates a chunk within its parent document.
func (c *Client) GenerateContext(ctx context.Context, docName, chunkContent string) (string, error) {
	systemPrompt := "You are a technical documentation assistant. Given a document name and a chunk of content from that document, generate a concise 1-2 sentence prefix that situates this chunk in the context of the overall document. The prefix should help a reader understand what this chunk is about without reading the full document. Output only the prefix text, nothing else."

	userPrompt := fmt.Sprintf("Document: %s\n\nChunk:\n%s", docName, chunkContent)

	resp, err := c.openaiClient.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: c.model,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		MaxTokens:   param.NewOpt(int64(c.maxTokens)),
		Temperature: param.NewOpt(0.0),
	})
	if err != nil {
		return "", fmt.Errorf("failed to generate context: %w", err)
	}

	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("empty LLM response")
	}

	return resp.Choices[0].Message.Content, nil
}

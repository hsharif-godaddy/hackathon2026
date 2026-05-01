package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	sdk "github.com/anthropics/anthropic-sdk-go"
)

// JudgeConfigRuntime configures the LLM judge at runtime.
type JudgeConfigRuntime struct {
	APICall  APICallFunc
	Model    string
	Criteria []Criterion
}

// JudgeInput is the data sent to the judge for evaluation.
type JudgeInput struct {
	UserMessage      string
	Persona          string
	ProjectName      string
	TodoList         string
	QuestionsPayload string
	HandoffPrompt    string
}

// JudgeScore is a single criterion score with reasoning.
type JudgeScore struct {
	Score     int    `json:"score"`
	Reasoning string `json:"reasoning"`
}

// Judge evaluates agent outputs using an LLM.
type Judge struct{ cfg JudgeConfigRuntime }

// NewJudge creates a new Judge with the given configuration.
func NewJudge(cfg JudgeConfigRuntime) *Judge {
	return &Judge{cfg: cfg}
}

// Evaluate sends agent outputs to the judge LLM and parses scores.
// Returns map of criterion name -> JudgeScore, token usage, and error.
func (j *Judge) Evaluate(ctx context.Context, input JudgeInput) (map[string]JudgeScore, *TokenUsage, error) {
	prompt := j.buildPrompt(input)

	params := sdk.MessageNewParams{
		Model:     j.cfg.Model,
		MaxTokens: 4000,
		System: []sdk.TextBlockParam{
			{
				Text: "You are a harsh, calibrated evaluator of AI agent outputs. " +
					"Use the FULL 1-5 scale. Most outputs should score 3 (competent). " +
					"Reserve 5 for truly exceptional work — something a senior designer would praise. " +
					"A score of 4 means notably good with minor gaps. " +
					"A score of 3 means solid and competent but not remarkable. " +
					"A score of 2 means significant weaknesses. " +
					"A score of 1 means fundamentally fails the criterion. " +
					"If you find yourself giving all 5s, you are not being critical enough. " +
					"Always respond with valid JSON only, no markdown fences.",
			},
		},
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock(prompt)),
		},
	}

	resp, err := j.cfg.APICall(ctx, params)
	if err != nil {
		return nil, nil, fmt.Errorf("judge API call failed: %w", err)
	}

	usage := &TokenUsage{
		InputTokens:         resp.Usage.InputTokens,
		OutputTokens:        resp.Usage.OutputTokens,
		CacheCreationTokens: resp.Usage.CacheCreationInputTokens,
		CacheReadTokens:     resp.Usage.CacheReadInputTokens,
	}

	// Check for truncation before parsing.
	if resp.StopReason == "max_tokens" {
		return nil, usage, fmt.Errorf(
			"judge response truncated (hit max_tokens limit, output_tokens=%d)",
			resp.Usage.OutputTokens,
		)
	}

	// Extract and concatenate all text content blocks from the response.
	var textBuilder strings.Builder
	for _, block := range resp.Content {
		if block.Type == blockTypeText {
			textBuilder.WriteString(block.Text)
		}
	}
	text := textBuilder.String()

	// Strip markdown code fences if present.
	text = stripMarkdownFences(text)

	// Parse the JSON response, attempting brace repair if needed.
	var result struct {
		Scores map[string]JudgeScore `json:"scores"`
	}
	parseErr := json.Unmarshal([]byte(text), &result)
	if parseErr != nil {
		// Try appending up to 3 closing braces to repair truncated JSON.
		for i := 1; i <= 3; i++ {
			attempt := text + strings.Repeat("}", i)
			if json.Unmarshal([]byte(attempt), &result) == nil {
				parseErr = nil
				break
			}
		}
	}
	if parseErr != nil {
		// Log diagnostics to help debug judge failures.
		head := text
		if len(head) > 300 {
			head = head[:300] + "..."
		}
		tail := text
		if len(tail) > 300 {
			tail = "..." + tail[len(tail)-300:]
		}
		return nil, usage, fmt.Errorf(
			"judge response is not valid JSON: %w\n"+
				"  stop_reason=%s, output_tokens=%d, blocks=%d, len=%d\n"+
				"  head: %s\n"+
				"  tail: %s",
			parseErr, resp.StopReason, resp.Usage.OutputTokens,
			len(resp.Content), len(text), head, tail,
		)
	}

	return result.Scores, usage, nil
}

// buildPrompt constructs the evaluation prompt from the input and criteria.
func (j *Judge) buildPrompt(input JudgeInput) string {
	var sb strings.Builder

	sb.WriteString("Evaluate the following AI agent output against the given criteria.\n\n")
	sb.WriteString("## User Request\n")
	sb.WriteString(input.UserMessage)
	if input.Persona != "" {
		sb.WriteString("\n\n## User Persona\n")
		sb.WriteString(input.Persona)
	}
	sb.WriteString("\n\n## Project Name\n")
	sb.WriteString(input.ProjectName)
	if input.TodoList != "" {
		sb.WriteString("\n\n## Feature List (todoList)\n")
		sb.WriteString(input.TodoList)
	}
	if input.QuestionsPayload != "" {
		sb.WriteString("\n\n## Questions Asked (askQuestion payloads)\n")
		sb.WriteString(input.QuestionsPayload)
	}
	sb.WriteString("\n\n## Agent Handoff Prompt\n")
	sb.WriteString(input.HandoffPrompt)
	sb.WriteString("\n\n## Evaluation Criteria\n")

	for _, c := range j.cfg.Criteria {
		sb.WriteString(fmt.Sprintf("- **%s**: %s (Scale: %s)\n", c.Name, c.Description, c.Scale))
	}

	sb.WriteString("\n## Scoring Guide\n")
	sb.WriteString("1=fails, 2=weak, 3=competent/solid, 4=strong with minor gaps, 5=exceptional (rare)\n")
	sb.WriteString("Most competent work deserves a 3. Only give 5 if you'd show it as an example of excellence.\n\n")
	sb.WriteString("## Response Format\n")
	sb.WriteString("Score first, then brief reasoning (max 2 sentences per criterion).\n")
	sb.WriteString(`Respond with JSON only:
{"scores":{"criterion_name":{"score":N,"reasoning":"..."},...}}`)

	return sb.String()
}

// stripMarkdownFences removes ```json ... ``` or ``` ... ``` wrappers if present.
func stripMarkdownFences(text string) string {
	text = strings.TrimSpace(text)

	// Handle ```json fences.
	if after, ok := strings.CutPrefix(text, "```json"); ok {
		text = after
		text = strings.TrimSuffix(text, "```")
		return strings.TrimSpace(text)
	}

	// Handle plain ``` fences.
	if after, ok := strings.CutPrefix(text, "```"); ok {
		text = after
		text = strings.TrimSuffix(text, "```")
		return strings.TrimSpace(text)
	}

	return text
}

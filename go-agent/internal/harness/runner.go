package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	sdk "github.com/anthropics/anthropic-sdk-go"
)

const (
	toolAskQuestion = "askQuestion"
	blockTypeText   = "text"
)

// APICallFunc is the function signature for making Claude API calls (non-streaming).
type APICallFunc func(ctx context.Context, params sdk.MessageNewParams) (*sdk.Message, error)

// ResponderFunc simulates user answers to askQuestion calls.
type ResponderFunc func(ctx context.Context, questions json.RawMessage, persona, userMessage string) (string, *TokenUsage, error)

// RunnerConfig holds all configuration for a conversation runner.
type RunnerConfig struct {
	MaxSteps     int
	StopAfter    []string // tool names that end the loop (handoff, websiteRebuild, askQuestion)
	SystemPrompt string
	Model        string
	Temperature  float64
	MaxTokens    int
	Effort       string
	APICall      APICallFunc
	Responder    ResponderFunc // called when askQuestion is invoked
	Persona      string        // persona for the responder
	UserMessage  string        // original user message for responder context
}

// TurnTiming captures timing for a single conversation turn.
type TurnTiming struct {
	Turn         int      `json:"turn"`                   // 1-based turn number
	ToolsCalled  []string `json:"tools_called"`           // tool names called this turn
	LatencyMs    int64    `json:"latency_ms"`             // total turn time including API call
	APIMs        int64    `json:"api_ms"`                 // API call duration (time to full response)
	InputTokens  int64    `json:"input_tokens"`           // input tokens for this turn
	OutputTokens int64    `json:"output_tokens"`          // output tokens for this turn
	TextContent  string   `json:"text_content,omitempty"` // assistant text (non-tool) content
}

// RunResult captures the outcome of a multi-turn conversation run.
type RunResult struct {
	ProjectName         string
	HandoffTarget       string
	HandoffPrompt       string
	TodoList            json.RawMessage
	AskedQuestions      bool
	QuestionsAsked      []string
	AskQuestionPayloads []json.RawMessage
	Complete            bool
	FailReason          string // non-empty if the run did not complete successfully
	Turns               int
	LatencyMs           int64
	TurnTimings         []TurnTiming
	AgentTokens         TokenUsage
	ResponderTokens     TokenUsage
}

// Runner orchestrates a multi-turn conversation loop with tool simulation.
type Runner struct {
	cfg RunnerConfig
}

// NewRunner creates a new conversation runner with the given configuration.
func NewRunner(cfg RunnerConfig) *Runner {
	return &Runner{cfg: cfg}
}

// Run executes the conversation loop starting with the given user message.
func (r *Runner) Run(ctx context.Context, userMessage string) (*RunResult, error) {
	start := time.Now()
	result := &RunResult{}

	// Build system prompt with cache control.
	system := []sdk.TextBlockParam{
		{
			Text:         r.cfg.SystemPrompt,
			CacheControl: sdk.NewCacheControlEphemeralParam(),
		},
	}

	// Build tool definitions for the API.
	tools := buildToolParams()

	// Initialize messages with the user message.
	messages := []sdk.MessageParam{
		sdk.NewUserMessage(sdk.NewTextBlock(userMessage)),
	}

	for turn := range r.cfg.MaxSteps {
		// Build request params.
		params := sdk.MessageNewParams{
			Model:     r.cfg.Model,
			System:    system,
			Messages:  messages,
			MaxTokens: int64(r.cfg.MaxTokens),
			Tools:     tools,
		}

		if r.cfg.Temperature > 0 {
			params.Temperature = sdk.Float(r.cfg.Temperature)
		}

		if r.cfg.Effort != "" {
			params.OutputConfig = sdk.OutputConfigParam{
				Effort: sdk.OutputConfigEffort(r.cfg.Effort),
			}
		}

		// Call the API with timing.
		turnStart := time.Now()
		resp, err := r.cfg.APICall(ctx, params)
		apiDuration := time.Since(turnStart)
		if err != nil {
			return nil, fmt.Errorf("API call failed on turn %d: %w", turn+1, err)
		}

		result.Turns = turn + 1

		// Track token usage.
		result.AgentTokens = result.AgentTokens.Add(TokenUsage{
			InputTokens:         resp.Usage.InputTokens,
			OutputTokens:        resp.Usage.OutputTokens,
			CacheCreationTokens: resp.Usage.CacheCreationInputTokens,
			CacheReadTokens:     resp.Usage.CacheReadInputTokens,
		})

		// Extract tool calls from response.
		toolCalls := extractToolCalls(resp)

		// Record per-turn timing (before any early exits).
		var toolNames []string
		for _, tc := range toolCalls {
			toolNames = append(toolNames, tc.name)
		}
		var textContent strings.Builder
		for _, block := range resp.Content {
			if block.Type == blockTypeText && block.Text != "" {
				if textContent.Len() > 0 {
					textContent.WriteString("\n")
				}
				textContent.WriteString(block.Text)
			}
		}
		result.TurnTimings = append(result.TurnTimings, TurnTiming{
			Turn:         turn + 1,
			ToolsCalled:  toolNames,
			APIMs:        apiDuration.Milliseconds(),
			LatencyMs:    time.Since(turnStart).Milliseconds(),
			InputTokens:  resp.Usage.InputTokens,
			OutputTokens: resp.Usage.OutputTokens,
			TextContent:  textContent.String(),
		})

		// If no tool calls, check stop reason before marking complete.
		if len(toolCalls) == 0 {
			if resp.StopReason == "end_turn" {
				result.Complete = true
				break
			}
			return nil, fmt.Errorf(
				"response stopped without tool calls on turn %d: stop_reason=%q",
				turn+1, resp.StopReason,
			)
		}

		// Build assistant message content blocks (preserving text + tool_use blocks).
		var assistantBlocks []sdk.ContentBlockParamUnion
		for _, block := range resp.Content {
			switch block.Type {
			case blockTypeText:
				if block.Text != "" {
					assistantBlocks = append(assistantBlocks, sdk.NewTextBlock(block.Text))
				}
			case "tool_use":
				assistantBlocks = append(assistantBlocks, sdk.NewToolUseBlock(block.ID, block.Input, block.Name))
			}
		}
		messages = append(messages, sdk.NewAssistantMessage(assistantBlocks...))

		// Process each tool call and build tool result blocks.
		var toolResultBlocks []sdk.ContentBlockParamUnion
		shouldStop := false
		askedQuestion := false

		for _, tc := range toolCalls {
			resultJSON := simulateTool(tc, result)
			toolResultBlocks = append(toolResultBlocks, sdk.NewToolResultBlock(tc.id, resultJSON, false))

			if tc.name == toolAskQuestion {
				askedQuestion = true
			}

			if r.isStopAfter(tc.name) && (tc.name != toolAskQuestion || r.cfg.Responder == nil) {
				shouldStop = true
			}
		}

		messages = append(messages, sdk.NewUserMessage(toolResultBlocks...))

		// If askQuestion was called and we have a responder, get the simulated answer.
		if askedQuestion && r.cfg.Responder != nil {
			answer, err := r.handleResponder(ctx, toolCalls, result)
			if err != nil {
				return nil, err
			}
			messages = append(messages, sdk.NewUserMessage(sdk.NewTextBlock(answer)))
			// Continue the loop (don't stop).
			continue
		}

		if shouldStop {
			result.Complete = true
			break
		}
	}

	result.LatencyMs = time.Since(start).Milliseconds()

	// Mark runs that never reached handoff as failures.
	if !result.Complete {
		result.FailReason = "max_steps_reached"
	} else if result.HandoffPrompt == "" {
		result.Complete = false
		result.FailReason = "no_handoff"
	}

	return result, nil
}

// toolCall holds parsed tool use data from a response.
type toolCall struct {
	id    string
	name  string
	input json.RawMessage
}

// extractToolCalls returns all tool_use blocks from a response.
func extractToolCalls(msg *sdk.Message) []toolCall {
	var calls []toolCall
	for _, block := range msg.Content {
		if block.Type == "tool_use" {
			calls = append(calls, toolCall{
				id:    block.ID,
				name:  block.Name,
				input: block.Input,
			})
		}
	}
	return calls
}

// simulateTool processes a tool call, captures relevant data in the result,
// and returns mock JSON response content.
func simulateTool(tc toolCall, result *RunResult) string {
	var args map[string]any
	_ = json.Unmarshal(tc.input, &args)

	switch tc.name {
	case "setProjectName":
		if name, ok := args["name"].(string); ok {
			result.ProjectName = name
		}
		resp, _ := json.Marshal(map[string]any{
			"success": true,
			"message": "Project name set to: " + result.ProjectName,
		})
		return string(resp)

	case "todoList":
		result.TodoList = tc.input
		return `{"success":true,"listId":"mock-list-001"}`

	case "handoff":
		if target, ok := args["targetAgent"].(string); ok {
			result.HandoffTarget = target
		}
		if prompt, ok := args["prompt"].(string); ok {
			result.HandoffPrompt = prompt
		}
		return `{"success":true,"handoff":"accepted"}`

	case "websiteRebuild":
		return `{"success":true,"status":"rebuild_started"}`

	case toolAskQuestion:
		result.AskedQuestions = true
		result.AskQuestionPayloads = append(result.AskQuestionPayloads, tc.input)
		if questions, ok := args["questions"].([]any); ok {
			for _, q := range questions {
				if qMap, ok := q.(map[string]any); ok {
					if qText, ok := qMap["question"].(string); ok {
						result.QuestionsAsked = append(result.QuestionsAsked, qText)
					}
				}
			}
		}
		return `{"success":true,"status":"questions_sent"}`

	default:
		return `{"success":true}`
	}
}

// handleResponder finds the askQuestion tool call, invokes the responder, and
// accumulates responder token usage into result. It returns the answer text.
func (r *Runner) handleResponder(ctx context.Context, toolCalls []toolCall, result *RunResult) (string, error) {
	for _, tc := range toolCalls {
		if tc.name == toolAskQuestion {
			answer, tokens, err := r.cfg.Responder(ctx, tc.input, r.cfg.Persona, r.cfg.UserMessage)
			if err != nil {
				return "", fmt.Errorf("responder failed: %w", err)
			}
			if tokens != nil {
				result.ResponderTokens = result.ResponderTokens.Add(*tokens)
			}
			return answer, nil
		}
	}
	return "", nil
}

// isStopAfter checks if a tool name is in the stop-after list.
func (r *Runner) isStopAfter(name string) bool {
	return slices.Contains(r.cfg.StopAfter, name)
}

// buildToolParams converts ToolDefinitions into SDK tool params.
func buildToolParams() []sdk.ToolUnionParam {
	defs := ToolDefinitions()
	tools := make([]sdk.ToolUnionParam, len(defs))
	for i, def := range defs {
		var schema map[string]any
		if err := json.Unmarshal([]byte(def.InputSchemaJSON), &schema); err != nil {
			panic(fmt.Sprintf("invalid tool schema for %s: %v", def.Name, err))
		}

		inputSchema := sdk.ToolInputSchemaParam{}

		// Extract properties and required from the schema.
		if props, ok := schema["properties"]; ok {
			inputSchema.Properties = props
		}
		if req, ok := schema["required"]; ok {
			inputSchema.Required = toStringSlice(req)
		}

		tools[i] = sdk.ToolUnionParam{
			OfTool: &sdk.ToolParam{
				Name:        def.Name,
				Description: sdk.String(def.Description),
				InputSchema: inputSchema,
			},
		}
	}
	return tools
}

// toStringSlice converts []any to []string for schema required fields.
func toStringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			result = append(result, s)
		}
	}
	return result
}

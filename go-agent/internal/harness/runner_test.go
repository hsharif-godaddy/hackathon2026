package harness

import (
	"context"
	"encoding/json"
	"testing"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testToolUse struct {
	ID    string
	Name  string
	Input json.RawMessage
}

func makeToolUseMessage(tools ...testToolUse) *sdk.Message {
	var blocks []sdk.ContentBlockUnion
	for _, t := range tools {
		blocks = append(blocks, sdk.ContentBlockUnion{
			Type:  "tool_use",
			ID:    t.ID,
			Name:  t.Name,
			Input: t.Input,
		})
	}
	return &sdk.Message{
		Content:    blocks,
		StopReason: sdk.StopReasonToolUse,
		Usage: sdk.Usage{
			InputTokens:              100,
			OutputTokens:             50,
			CacheCreationInputTokens: 10,
			CacheReadInputTokens:     5,
		},
	}
}

func TestRunnerSimpleHandoff(t *testing.T) {
	callCount := 0
	mockAPI := func(_ context.Context, _ sdk.MessageNewParams) (*sdk.Message, error) {
		callCount++
		return makeToolUseMessage(
			testToolUse{
				ID:    "tool_1",
				Name:  "setProjectName",
				Input: json.RawMessage(`{"name":"My Website"}`),
			},
			testToolUse{
				ID:   "tool_2",
				Name: "todoList",
				Input: json.RawMessage(
					`{"operation":"create_list","listName":"Build Plan","items":[{"title":"Setup"}]}`,
				),
			},
			testToolUse{
				ID:    "tool_3",
				Name:  "handoff",
				Input: json.RawMessage(`{"targetAgent":"coder","prompt":"Build the website"}`),
			},
		), nil
	}

	runner := NewRunner(RunnerConfig{
		MaxSteps:     10,
		StopAfter:    []string{"handoff", "websiteRebuild", "askQuestion"},
		SystemPrompt: "You are a helpful assistant.",
		Model:        "claude-sonnet-4-6-20250514",
		Temperature:  0.7,
		MaxTokens:    4096,
		APICall:      mockAPI,
	})

	result, err := runner.Run(context.Background(), "Build me a website")
	require.NoError(t, err)

	assert.Equal(t, "My Website", result.ProjectName)
	assert.Equal(t, "coder", result.HandoffTarget)
	assert.Equal(t, "Build the website", result.HandoffPrompt)
	assert.True(t, result.Complete)
	assert.Equal(t, 1, result.Turns)
	assert.Equal(t, 1, callCount)
	assert.False(t, result.AskedQuestions)
	assert.NotNil(t, result.TodoList)

	// Verify token tracking
	assert.Equal(t, int64(100), result.AgentTokens.InputTokens)
	assert.Equal(t, int64(50), result.AgentTokens.OutputTokens)
	assert.Equal(t, int64(10), result.AgentTokens.CacheCreationTokens)
	assert.Equal(t, int64(5), result.AgentTokens.CacheReadTokens)
}

func TestRunnerAskQuestionFlow(t *testing.T) {
	callCount := 0
	responderCalled := false

	mockAPI := func(_ context.Context, _ sdk.MessageNewParams) (*sdk.Message, error) {
		callCount++
		if callCount == 1 {
			return makeToolUseMessage(
				testToolUse{
					ID:   "tool_1",
					Name: "askQuestion",
					Input: json.RawMessage(
						`{"questions":[{"question":"What style do you want?","suggestions":["Modern","Classic"]}]}`,
					),
				},
			), nil
		}
		// Second call: after responder answers
		return makeToolUseMessage(
			testToolUse{
				ID:    "tool_2",
				Name:  "setProjectName",
				Input: json.RawMessage(`{"name":"Modern Site"}`),
			},
			testToolUse{
				ID:    "tool_3",
				Name:  "todoList",
				Input: json.RawMessage(`{"operation":"create_list","listName":"Plan"}`),
			},
			testToolUse{
				ID:    "tool_4",
				Name:  "handoff",
				Input: json.RawMessage(`{"targetAgent":"coder","prompt":"Build modern site"}`),
			},
		), nil
	}

	mockResponder := func(_ context.Context, _ json.RawMessage, _, _ string) (string, *TokenUsage, error) {
		responderCalled = true
		return "I want a modern style", &TokenUsage{InputTokens: 200, OutputTokens: 100}, nil
	}

	runner := NewRunner(RunnerConfig{
		MaxSteps:     10,
		StopAfter:    []string{"handoff", "websiteRebuild", "askQuestion"},
		SystemPrompt: "You are a helpful assistant.",
		Model:        "claude-sonnet-4-6-20250514",
		Temperature:  0.7,
		MaxTokens:    4096,
		APICall:      mockAPI,
		Responder:    mockResponder,
		Persona:      "friendly user",
		UserMessage:  "Build me a website",
	})

	result, err := runner.Run(context.Background(), "Build me a website")
	require.NoError(t, err)

	assert.True(t, result.AskedQuestions)
	assert.True(t, responderCalled)
	assert.Len(t, result.QuestionsAsked, 1)
	assert.Contains(t, result.QuestionsAsked[0], "What style do you want?")
	assert.Equal(t, "Modern Site", result.ProjectName)
	assert.Equal(t, "coder", result.HandoffTarget)
	assert.Equal(t, "Build modern site", result.HandoffPrompt)
	assert.True(t, result.Complete)
	assert.Equal(t, 2, result.Turns)
	assert.Equal(t, 2, callCount)

	// Verify responder tokens are tracked
	assert.Equal(t, int64(200), result.ResponderTokens.InputTokens)
	assert.Equal(t, int64(100), result.ResponderTokens.OutputTokens)

	// Verify full askQuestion payload is captured
	require.Len(t, result.AskQuestionPayloads, 1)
	assert.JSONEq(t,
		`{"questions":[{"question":"What style do you want?","suggestions":["Modern","Classic"]}]}`,
		string(result.AskQuestionPayloads[0]),
	)
}

func TestRunnerMaxSteps(t *testing.T) {
	callCount := 0
	mockAPI := func(_ context.Context, _ sdk.MessageNewParams) (*sdk.Message, error) {
		callCount++
		return makeToolUseMessage(
			testToolUse{
				ID:    "tool_1",
				Name:  "setProjectName",
				Input: json.RawMessage(`{"name":"My Site"}`),
			},
		), nil
	}

	runner := NewRunner(RunnerConfig{
		MaxSteps:     3,
		StopAfter:    []string{"handoff", "websiteRebuild", "askQuestion"},
		SystemPrompt: "You are a helpful assistant.",
		Model:        "claude-sonnet-4-6-20250514",
		Temperature:  0.7,
		MaxTokens:    4096,
		APICall:      mockAPI,
	})

	result, err := runner.Run(context.Background(), "Build me a website")
	require.NoError(t, err)

	assert.False(t, result.Complete)
	assert.Equal(t, 3, result.Turns)
	assert.Equal(t, 3, callCount)
}

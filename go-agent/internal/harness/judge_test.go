package harness

import (
	"context"
	"testing"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJudgeParseScores(t *testing.T) {
	mockAPI := func(_ context.Context, _ sdk.MessageNewParams) (*sdk.Message, error) {
		return &sdk.Message{
			Content: []sdk.ContentBlockUnion{
				{
					Type: "text",
					Text: `{"scores":{"clarity":{"score":4,"reasoning":"The handoff prompt was clear and well-structured"},"completeness":{"score":3,"reasoning":"Missing some details about the project requirements"}}}`,
				},
			},
			Usage: sdk.Usage{InputTokens: 3000, OutputTokens: 200},
		}, nil
	}

	judge := NewJudge(JudgeConfigRuntime{
		APICall: mockAPI,
		Model:   "claude-sonnet-4-6-20250514",
		Criteria: []Criterion{
			{Name: "clarity", Description: "How clear is the output", Scale: "1-5"},
			{Name: "completeness", Description: "How complete is the output", Scale: "1-5"},
		},
	})

	scores, usage, err := judge.Evaluate(context.Background(), JudgeInput{
		UserMessage:   "Build me a website",
		ProjectName:   "My Website",
		HandoffPrompt: "Build a modern website with React",
	})

	require.NoError(t, err)
	require.NotNil(t, usage)
	require.NotNil(t, scores)

	assert.Equal(t, int64(3000), usage.InputTokens)
	assert.Equal(t, int64(200), usage.OutputTokens)

	clarity, ok := scores["clarity"]
	require.True(t, ok, "expected clarity score")
	assert.Equal(t, 4, clarity.Score)
	assert.Equal(t, "The handoff prompt was clear and well-structured", clarity.Reasoning)

	completeness, ok := scores["completeness"]
	require.True(t, ok, "expected completeness score")
	assert.Equal(t, 3, completeness.Score)
	assert.Equal(t, "Missing some details about the project requirements", completeness.Reasoning)
}

func TestJudgeParseScoresWithMarkdownFences(t *testing.T) {
	mockAPI := func(_ context.Context, _ sdk.MessageNewParams) (*sdk.Message, error) {
		return &sdk.Message{
			Content: []sdk.ContentBlockUnion{
				{
					Type: "text",
					Text: "```json\n{\"scores\":{\"quality\":{\"score\":5,\"reasoning\":\"Excellent output\"}}}\n```",
				},
			},
			Usage: sdk.Usage{InputTokens: 1000, OutputTokens: 100},
		}, nil
	}

	judge := NewJudge(JudgeConfigRuntime{
		APICall: mockAPI,
		Model:   "claude-sonnet-4-6-20250514",
		Criteria: []Criterion{
			{Name: "quality", Description: "Overall quality", Scale: "1-5"},
		},
	})

	scores, usage, err := judge.Evaluate(context.Background(), JudgeInput{
		UserMessage:   "Build me a portfolio",
		ProjectName:   "Portfolio",
		HandoffPrompt: "Build a portfolio site",
	})

	require.NoError(t, err)
	require.NotNil(t, usage)
	require.NotNil(t, scores)

	assert.Equal(t, int64(1000), usage.InputTokens)

	quality, ok := scores["quality"]
	require.True(t, ok, "expected quality score")
	assert.Equal(t, 5, quality.Score)
	assert.Equal(t, "Excellent output", quality.Reasoning)
}

func TestJudgeHandlesInvalidJSON(t *testing.T) {
	mockAPI := func(_ context.Context, _ sdk.MessageNewParams) (*sdk.Message, error) {
		return &sdk.Message{
			Content: []sdk.ContentBlockUnion{
				{
					Type: "text",
					Text: "I cannot evaluate this output because it is not clear.",
				},
			},
			Usage: sdk.Usage{InputTokens: 500, OutputTokens: 50},
		}, nil
	}

	judge := NewJudge(JudgeConfigRuntime{
		APICall: mockAPI,
		Model:   "claude-sonnet-4-6-20250514",
		Criteria: []Criterion{
			{Name: "clarity", Description: "How clear is the output", Scale: "1-5"},
		},
	})

	scores, usage, err := judge.Evaluate(context.Background(), JudgeInput{
		UserMessage:   "Build me a website",
		ProjectName:   "My Website",
		HandoffPrompt: "Build a website",
	})

	require.Error(t, err)
	assert.Nil(t, scores)
	assert.NotNil(t, usage, "usage should be returned even on parse failure")
	assert.Contains(t, err.Error(), "stop_reason=")
}

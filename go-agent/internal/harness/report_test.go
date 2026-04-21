package harness

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSaveResult(t *testing.T) {
	tmpDir := t.TempDir()

	result := &FullResult{
		ConfigName:  "experiment-a",
		TestCaseID:  "tc-001",
		RunNumber:   3,
		Timestamp:   time.Date(2026, 4, 15, 12, 0, 0, 0, time.UTC),
		Model:       "claude-sonnet-4-6-20250514",
		Temperature: 0.7,
		Effort:      "standard",
		Turns:       5,
		LatencyMs:   1234,
		AgentTokens: TokenUsage{
			InputTokens:  1000,
			OutputTokens: 500,
		},
		AgentCostUSD:  0.012,
		ProjectName:   "My Test Site",
		HandoffPrompt: "Build a modern website",
		HandoffTarget: "website-agent",
		Complete:      true,
		JudgeScores: map[string]JudgeScore{
			"clarity": {Score: 4, Reasoning: "Clear and concise"},
		},
	}

	err := SaveResult(tmpDir, result)
	require.NoError(t, err)

	expectedPath := filepath.Join(tmpDir, "experiment-a", "tc-001", "3.json")
	_, statErr := os.Stat(expectedPath)
	require.NoError(t, statErr, "expected file at %s", expectedPath)

	data, err := os.ReadFile(expectedPath)
	require.NoError(t, err)

	var loaded FullResult
	err = json.Unmarshal(data, &loaded)
	require.NoError(t, err)

	assert.Equal(t, result.ConfigName, loaded.ConfigName)
	assert.Equal(t, result.TestCaseID, loaded.TestCaseID)
	assert.Equal(t, result.RunNumber, loaded.RunNumber)
	assert.Equal(t, result.Model, loaded.Model)
	assert.InDelta(t, result.Temperature, loaded.Temperature, 1e-9)
	assert.Equal(t, result.Turns, loaded.Turns)
	assert.Equal(t, result.LatencyMs, loaded.LatencyMs)
	assert.InDelta(t, result.AgentCostUSD, loaded.AgentCostUSD, 1e-9)
	assert.Equal(t, result.ProjectName, loaded.ProjectName)
	assert.Equal(t, result.Complete, loaded.Complete)
	assert.Equal(t, 4, loaded.JudgeScores["clarity"].Score)

	// Verify indented JSON (2-space indent)
	assert.Contains(t, string(data), "\n  ")
}

func TestPrintSummary(t *testing.T) {
	results := []*FullResult{
		{
			ConfigName:       "my-experiment",
			TestCaseID:       "tc-homepage",
			RunNumber:        1,
			Model:            "claude-sonnet-4-6-20250514",
			Temperature:      0.5,
			Effort:           "high",
			Turns:            3,
			LatencyMs:        2000,
			AgentCostUSD:     0.010,
			ResponderCostUSD: 0.002,
			JudgeCostUSD:     0.001,
			ProjectName:      "Homepage Project",
			TurnTimings: []TurnTiming{
				{
					Turn: 1, APIMs: 800, LatencyMs: 850,
					ToolsCalled:  []string{"askQuestion"},
					InputTokens:  2000,
					OutputTokens: 300,
				},
				{
					Turn: 2, APIMs: 600, LatencyMs: 650,
					ToolsCalled:  []string{"setProjectName", "todoList"},
					InputTokens:  2500,
					OutputTokens: 400,
				},
				{
					Turn: 3, APIMs: 500, LatencyMs: 550,
					ToolsCalled:  []string{"handoff"},
					InputTokens:  3000,
					OutputTokens: 2000,
				},
			},
			Complete: true,
			JudgeScores: map[string]JudgeScore{
				"clarity":      {Score: 4, Reasoning: "Good"},
				"completeness": {Score: 5, Reasoning: "Complete"},
			},
		},
		{
			ConfigName:       "my-experiment",
			TestCaseID:       "tc-portfolio",
			RunNumber:        1,
			Model:            "claude-sonnet-4-6-20250514",
			Temperature:      0.5,
			Effort:           "high",
			Turns:            2,
			LatencyMs:        3000,
			AgentCostUSD:     0.015,
			ResponderCostUSD: 0.003,
			JudgeCostUSD:     0.002,
			ProjectName:      "Portfolio Project",
			TurnTimings: []TurnTiming{
				{
					Turn: 1, APIMs: 1500, LatencyMs: 1600,
					ToolsCalled:  []string{"setProjectName", "todoList"},
					InputTokens:  1800,
					OutputTokens: 350,
				},
				{
					Turn: 2, APIMs: 1200, LatencyMs: 1300,
					ToolsCalled:  []string{"handoff"},
					InputTokens:  2800,
					OutputTokens: 1800,
				},
			},
			Complete: true,
			JudgeScores: map[string]JudgeScore{
				"clarity":      {Score: 3, Reasoning: "Average"},
				"completeness": {Score: 4, Reasoning: "Mostly complete"},
			},
		},
	}

	var buf bytes.Buffer
	PrintSummary(&buf, "my-experiment", results)

	output := buf.String()

	// Header checks
	assert.Contains(t, output, "my-experiment", "should contain config name")
	assert.Contains(t, output, "2 results", "should show result count")
	assert.Contains(t, output, "claude-sonnet-4-6-20250514", "should show model")

	// Test case and project name checks
	assert.Contains(t, output, "tc-homepage", "should contain first test case ID")
	assert.Contains(t, output, "tc-portfolio", "should contain second test case ID")
	assert.Contains(t, output, "Homepage Project", "should contain first project name")
	assert.Contains(t, output, "Portfolio Project", "should contain second project name")

	// Timing columns
	assert.Contains(t, output, "TTFB", "should have TTFB column header")
	assert.Contains(t, output, "0.8s", "should show first result's TTFB (800ms)")

	// Score checks ("N/5" format)
	assert.Contains(t, output, "4/5", "should show score as N/5")
	assert.Contains(t, output, "5/5", "should show score as N/5")
	assert.Contains(t, output, "3/5", "should show score as N/5")

	// Totals check
	totalCost := 0.010 + 0.002 + 0.001 + 0.015 + 0.003 + 0.002
	_ = totalCost
	assert.True(t, strings.Contains(output, "Total") || strings.Contains(output, "total"),
		"should contain totals section")

	// Averages check — go-pretty footer may uppercase
	lowerOutput := strings.ToLower(output)
	assert.Contains(t,
		lowerOutput, "avg",
		"should contain averages row",
	)

	// Per-tool breakdown table checks (go-pretty uppercases headers)
	assert.Contains(t, output, "Per-Tool Breakdown", "should have per-tool section header")
	assert.Contains(t, lowerOutput, "avg in tok", "should have input token column")
	assert.Contains(t, lowerOutput, "avg out tok", "should have output token column")
	assert.Contains(t, lowerOutput, "min api", "should have min api column")
	assert.Contains(t, lowerOutput, "max api", "should have max api column")
	assert.Contains(t, output, "handoff", "should show handoff as a tool group")
}

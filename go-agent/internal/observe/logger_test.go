package observe

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/eventbus"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
)

// logEntry represents a single JSON log line for test assertions.
type logEntry struct {
	Level   string `json:"level"`
	Msg     string `json:"msg"`
	RunID   string `json:"runId"`
	AppID   string `json:"appId"`
	AgentID string `json:"agentId"`

	// Event-specific fields.
	TokenCount  int    `json:"tokenCount"`
	TokensIn    int    `json:"tokensIn"`
	TokensOut   int    `json:"tokensOut"`
	CacheRead   int    `json:"cacheRead"`
	Iteration   int    `json:"iteration"`
	Tool        string `json:"tool"`
	CallID      string `json:"callId"`
	DurationMs  int64  `json:"durationMs"`
	Error       string `json:"error"`
	Reason      string `json:"reason"`
	Iterations  int    `json:"iterations"`
	ToolsCalled int    `json:"toolsCalled"`
	Type        string `json:"type"`
	Length      int    `json:"length"`
	ChunkLen    int    `json:"chunkLen"`
}

func parseLogEntries(t *testing.T, buf *bytes.Buffer) []logEntry {
	t.Helper()
	var entries []logEntry
	for line := range strings.SplitSeq(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var entry logEntry
		require.NoError(t, json.Unmarshal([]byte(line), &entry), "bad log line: %s", line)
		entries = append(entries, entry)
	}
	return entries
}

func findLogEntry(entries []logEntry, msg string) *logEntry {
	for i := range entries {
		if entries[i].Msg == msg {
			return &entries[i]
		}
	}
	return nil
}

func setupLogger() (*bytes.Buffer, *slog.Logger) {
	var buf bytes.Buffer
	handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	logger := slog.New(handler)
	return &buf, logger
}

// publishAndCollect publishes an event and returns log entries after draining.
// cancel() closes the subscription channel and waits for the goroutine to
// finish draining, so no time.Sleep is needed.
func publishAndCollect(
	t *testing.T,
	eventType run.EventType,
	data any,
) []logEntry {
	t.Helper()
	buf, logger := setupLogger()
	bus := eventbus.New()
	sub := NewLogSubscriber(logger)

	cancel := sub.Subscribe(bus, "run1", "app1", "develop")
	bus.Publish("run:run1", run.NewEvent(eventType, data))
	cancel()

	return parseLogEntries(t, buf)
}

func TestLogSubscriber_RunStarted(t *testing.T) {
	entries := publishAndCollect(t, run.EventRunStarted, run.StartedData{
		AgentID: "develop",
		AppID:   "app1",
	})

	entry := findLogEntry(entries, "run.begin")
	require.NotNil(t, entry)
	assert.Equal(t, "INFO", entry.Level)
	assert.Equal(t, "run1", entry.RunID)
	assert.Equal(t, "app1", entry.AppID)
	assert.Equal(t, "develop", entry.AgentID)
}

func TestLogSubscriber_PromptBuilt(t *testing.T) {
	entries := publishAndCollect(t, run.EventPromptBuilt, run.PromptBuiltData{
		TokenCount: 500,
	})

	entry := findLogEntry(entries, "prompt.build.success")
	require.NotNil(t, entry)
	assert.Equal(t, 500, entry.TokenCount)
}

func TestLogSubscriber_LLMResponse(t *testing.T) {
	entries := publishAndCollect(t, run.EventLLMResponse, run.LLMResponseData{
		TokensIn:  100,
		TokensOut: 50,
		CacheRead: 80,
		Iteration: 2,
	})

	entry := findLogEntry(entries, "llm.response.success")
	require.NotNil(t, entry)
	assert.Equal(t, 100, entry.TokensIn)
	assert.Equal(t, 50, entry.TokensOut)
	assert.Equal(t, 80, entry.CacheRead)
	assert.Equal(t, 2, entry.Iteration)
}

func TestLogSubscriber_ToolCallSuccess(t *testing.T) {
	buf, logger := setupLogger()
	bus := eventbus.New()
	sub := NewLogSubscriber(logger)

	cancel := sub.Subscribe(bus, "run1", "app1", "develop")
	bus.Publish("run:run1", run.NewEvent(run.EventToolCallStart, run.ToolStartData{
		Name: "readFile",
		ID:   "call1",
	}))
	bus.Publish("run:run1", run.NewEvent(run.EventToolCallResult, run.ToolResultData{
		Name:     "readFile",
		ID:       "call1",
		Duration: 150 * time.Millisecond,
	}))
	cancel()

	entries := parseLogEntries(t, buf)

	start := findLogEntry(entries, "tool.call.begin")
	require.NotNil(t, start)
	assert.Equal(t, "readFile", start.Tool)
	assert.Equal(t, "call1", start.CallID)

	result := findLogEntry(entries, "tool.call.success")
	require.NotNil(t, result)
	assert.Equal(t, "readFile", result.Tool)
	assert.Equal(t, int64(150), result.DurationMs)
}

func TestLogSubscriber_ToolCallFailure(t *testing.T) {
	entries := publishAndCollect(t, run.EventToolCallResult, run.ToolResultData{
		Name:     "terminalCommand",
		ID:       "call2",
		Duration: 5 * time.Second,
		ErrMsg:   "command timed out",
	})

	entry := findLogEntry(entries, "tool.call.failure")
	require.NotNil(t, entry)
	assert.Equal(t, "WARN", entry.Level)
	assert.Equal(t, "command timed out", entry.Error)
}

func TestLogSubscriber_RunCompleted(t *testing.T) {
	entries := publishAndCollect(t, run.EventRunCompleted, run.CompletedData{
		FinalMessage: "Done!",
		Iterations:   3,
		ToolsCalled:  5,
	})

	entry := findLogEntry(entries, "run.success")
	require.NotNil(t, entry)
	assert.Equal(t, "INFO", entry.Level)
	assert.Equal(t, 3, entry.Iterations)
	assert.Equal(t, 5, entry.ToolsCalled)
}

func TestLogSubscriber_RunCancelled(t *testing.T) {
	entries := publishAndCollect(t, run.EventRunCancelled, run.CancelledData{
		Reason: "budget exceeded",
	})

	entry := findLogEntry(entries, "run.cancel")
	require.NotNil(t, entry)
	assert.Equal(t, "WARN", entry.Level)
	assert.Equal(t, "budget exceeded", entry.Reason)
}

func TestLogSubscriber_RunFailed(t *testing.T) {
	entries := publishAndCollect(t, run.EventRunFailed, run.FailedData{
		Error: "API rate limit exceeded",
	})

	entry := findLogEntry(entries, "run.failure")
	require.NotNil(t, entry)
	assert.Equal(t, "ERROR", entry.Level)
	assert.Equal(t, "API rate limit exceeded", entry.Error)
}

func TestLogSubscriber_CancelStopsSubscription(t *testing.T) {
	buf, logger := setupLogger()
	bus := eventbus.New()
	sub := NewLogSubscriber(logger)

	cancel := sub.Subscribe(bus, "run1", "app1", "develop")
	cancel()

	// Publishing after cancel should not produce log output.
	bus.Publish("run:run1", run.NewEvent(run.EventRunStarted, run.StartedData{}))

	assert.Empty(t, buf.String())
}

func TestLogSubscriber_NilDataEvent(t *testing.T) {
	entries := publishAndCollect(t, run.EventLLMRequestStart, nil)

	entry := findLogEntry(entries, "run.event")
	require.NotNil(t, entry)
	assert.Equal(t, "DEBUG", entry.Level)
	assert.Equal(t, "llm.request.start", entry.Type)
}

func TestLogSubscriber_TokenData(t *testing.T) {
	entries := publishAndCollect(t, run.EventLLMToken, run.TokenData{
		Text: "hello world",
	})

	entry := findLogEntry(entries, "llm.token")
	require.NotNil(t, entry)
	assert.Equal(t, "DEBUG", entry.Level)
	assert.Equal(t, 11, entry.Length)
}

func TestLogSubscriber_ToolOutput(t *testing.T) {
	entries := publishAndCollect(t, run.EventToolOutput, run.ToolOutputData{
		Name:  "readFile",
		ID:    "call1",
		Chunk: "file contents here",
	})

	entry := findLogEntry(entries, "tool.output")
	require.NotNil(t, entry)
	assert.Equal(t, "DEBUG", entry.Level)
	assert.Equal(t, "readFile", entry.Tool)
	assert.Equal(t, "call1", entry.CallID)
	assert.Equal(t, 18, entry.ChunkLen)
}

func TestLogSubscriber_UnknownDataType(t *testing.T) {
	entries := publishAndCollect(t, run.EventBudgetWarning, "unexpected string data")

	entry := findLogEntry(entries, "run.event.unknown")
	require.NotNil(t, entry)
	assert.Equal(t, "DEBUG", entry.Level)
	assert.Equal(t, "budget.warning", entry.Type)
}

package observe

import (
	"log/slog"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/eventbus"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
)

// LogSubscriber listens to run events and produces structured log output
// following the domain.operation.lifecycle naming convention.
type LogSubscriber struct {
	logger *slog.Logger
}

// NewLogSubscriber creates a subscriber that logs run events.
func NewLogSubscriber(logger *slog.Logger) *LogSubscriber {
	return &LogSubscriber{logger: logger}
}

// Subscribe listens to events on the given run topic and logs each one.
// It returns a cancel function that stops the subscription.
// The subscriber runs in a background goroutine.
func (l *LogSubscriber) Subscribe(
	bus *eventbus.Bus,
	runID string,
	appID string,
	agentID string,
) func() {
	sub := bus.Subscribe("run:"+runID, 64)
	base := l.logger.With(
		"runId", runID,
		"appId", appID,
		"agentId", agentID,
	)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for raw := range sub.Ch {
			ev, ok := raw.(run.Event)
			if !ok {
				continue
			}
			l.logEvent(base, ev)
		}
	}()

	return func() {
		sub.Close()
		<-done
	}
}

func (l *LogSubscriber) logEvent(logger *slog.Logger, ev run.Event) {
	switch data := ev.Data.(type) {
	case run.StartedData:
		logger.Info("run.begin")

	case run.PromptBuiltData:
		logger.Info("prompt.build.success",
			"tokenCount", data.TokenCount,
		)

	case nil:
		// Events like LLMLoopIter, LLMRequestStart, LLMStreamStart
		// carry no data — log the event type as-is.
		logger.Debug("run.event", "type", string(ev.Type))

	case run.TokenData:
		// Token events are too noisy for info level.
		logger.Debug("llm.token", "length", len(data.Text))

	case run.LLMResponseData:
		logger.Info("llm.response.success",
			"tokensIn", data.TokensIn,
			"tokensOut", data.TokensOut,
			"cacheRead", data.CacheRead,
			"iteration", data.Iteration,
		)

	case run.ToolStartData:
		logger.Info("tool.call.begin",
			"tool", data.Name,
			"callId", data.ID,
		)

	case run.ToolOutputData:
		logger.Debug("tool.output",
			"tool", data.Name,
			"callId", data.ID,
			"chunkLen", len(data.Chunk),
		)

	case run.ToolResultData:
		if data.ErrMsg != "" {
			logger.Warn("tool.call.failure",
				"tool", data.Name,
				"callId", data.ID,
				"durationMs", data.Duration.Milliseconds(),
				"error", data.ErrMsg,
			)
		} else {
			logger.Info("tool.call.success",
				"tool", data.Name,
				"callId", data.ID,
				"durationMs", data.Duration.Milliseconds(),
			)
		}

	case run.CompletedData:
		logger.Info("run.success",
			"iterations", data.Iterations,
			"toolsCalled", data.ToolsCalled,
		)

	case run.CancelledData:
		logger.Warn("run.cancel",
			"reason", data.Reason,
		)

	case run.FailedData:
		logger.Error("run.failure",
			"error", data.Error,
		)

	default:
		logger.Debug("run.event.unknown",
			"type", string(ev.Type),
		)
	}
}

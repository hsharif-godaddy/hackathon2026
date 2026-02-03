package main

import (
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
)

type LogsGetRequest struct {
	Lines  int    `json:"lines,omitempty"`
	Source string `json:"source,omitempty"`
	Since  string `json:"since,omitempty"`
}

type LogsGetResponse struct {
	Logs  []logs.LogEntry `json:"logs"`
	Total int             `json:"total"`
}

type LogManager struct {
	mu      sync.RWMutex
	logs    []logs.LogEntry
	maxLogs int
}

func NewLogManager(maxLogs int) *LogManager {
	if maxLogs <= 0 {
		maxLogs = 10000 // Default buffer size
	}

	return &LogManager{
		logs:    make([]logs.LogEntry, 0),
		maxLogs: maxLogs,
	}
}

func (lm *LogManager) AddLog(entry logs.LogEntry) {
	lm.mu.Lock()
	defer lm.mu.Unlock()

	// Add to buffer
	lm.logs = append(lm.logs, entry)

	// Trim buffer if it exceeds max size
	if len(lm.logs) > lm.maxLogs {
		// Remove oldest 10% when buffer is full
		removeCount := max(lm.maxLogs/10, 1)
		lm.logs = lm.logs[removeCount:]
	}
}

func (lm *LogManager) GetLogs(req LogsGetRequest) (*LogsGetResponse, error) {
	lm.mu.RLock()
	defer lm.mu.RUnlock()

	var filteredLogs []logs.LogEntry

	// Parse since timestamp if provided
	var sinceTime time.Time
	if req.Since != "" {
		var err error
		// Try RFC3339Nano first, then fall back to RFC3339
		sinceTime, err = time.Parse(time.RFC3339Nano, req.Since)
		if err != nil {
			sinceTime, err = time.Parse(time.RFC3339, req.Since)
			if err != nil {
				return nil, fmt.Errorf("invalid since timestamp: %w", err)
			}
		}
	}

	// Filter logs
	for _, log := range lm.logs {
		// Filter by timestamp
		if !sinceTime.IsZero() && log.Timestamp.Before(sinceTime) {
			continue
		}

		// Filter by source
		if req.Source != "" && log.Source != req.Source {
			continue
		}

		filteredLogs = append(filteredLogs, log)
	}

	// Limit number of logs if specified
	if req.Lines > 0 && len(filteredLogs) > req.Lines {
		// Return the last N logs
		start := len(filteredLogs) - req.Lines
		filteredLogs = filteredLogs[start:]
	}

	return &LogsGetResponse{
		Logs:  filteredLogs,
		Total: len(filteredLogs),
	}, nil
}

func (lm *LogManager) GetStats() map[string]any {
	lm.mu.RLock()
	defer lm.mu.RUnlock()

	return map[string]any{
		"total_logs": len(lm.logs),
		"max_logs":   lm.maxLogs,
	}
}

// HTTP handler helpers
func (lm *LogManager) parseLogsGetRequest(r *http.Request) LogsGetRequest {
	req := LogsGetRequest{}

	// Parse query parameters
	if lines := r.URL.Query().Get("lines"); lines != "" {
		if parsed, err := strconv.Atoi(lines); err == nil {
			req.Lines = parsed
		}
	}

	req.Source = r.URL.Query().Get("source")
	req.Since = r.URL.Query().Get("since")

	return req
}

package logs

import (
	"fmt"
	"sync"
	"time"
)

type Manager struct {
	mu      sync.RWMutex
	logs    []LogEntry
	maxLogs int
}

func NewManager(maxLogs int) *Manager {
	if maxLogs <= 0 {
		maxLogs = 10000 // Default buffer size
	}

	return &Manager{
		logs:    make([]LogEntry, 0),
		maxLogs: maxLogs,
	}
}

func (lm *Manager) AddLog(entry LogEntry) {
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

func (lm *Manager) GetLogs(req GetRequest) (*GetResponse, error) {
	// Parse since timestamp before taking lock (no shared state access)
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

	// Snapshot logs under RLock, then release before filtering
	logsCopy := lm.snapshot()

	// Filter logs without holding lock (prevents blocking AddLog writers)
	var filteredLogs []LogEntry
	for _, log := range logsCopy {
		// Filter by timestamp
		if !sinceTime.IsZero() && log.Timestamp.Before(sinceTime) {
			continue
		}

		// Filter by source
		if req.Source != "" && log.Source != req.Source {
			continue
		}

		// Filter by command ID. Zero is the "no filter" sentinel so
		// callers that omit CommandID see every entry (including those
		// with CommandID=0 from the managed process and health monitor).
		if req.CommandID != 0 && log.CommandID != req.CommandID {
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

	return &GetResponse{
		Logs:  filteredLogs,
		Total: len(filteredLogs),
	}, nil
}

// snapshot creates a copy of the log buffer under read lock.
// This allows filtering to proceed without holding locks that block writers.
func (lm *Manager) snapshot() []LogEntry {
	lm.mu.RLock()
	defer lm.mu.RUnlock()

	snapshot := make([]LogEntry, len(lm.logs))
	copy(snapshot, lm.logs)
	return snapshot
}

func (lm *Manager) GetStats() map[string]any {
	lm.mu.RLock()
	defer lm.mu.RUnlock()

	return map[string]any{
		"total_logs": len(lm.logs),
		"max_logs":   lm.maxLogs,
	}
}

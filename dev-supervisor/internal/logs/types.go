package logs

import "time"

// LogEntry represents a log entry
type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Source    string    `json:"source"`
	Message   string    `json:"message"`
	Level     string    `json:"level,omitempty"`
	// CommandID correlates multiple log lines produced by a single /exec
	// invocation. Non-zero only for entries tee'd from /exec (Source="exec").
	// Zero for the managed process's own output and for health-monitor entries.
	CommandID uint64 `json:"command_id,omitempty"`
}

// Logger is the interface for logging events
type Logger interface {
	AddLog(entry LogEntry)
}

// GetRequest defines parameters for retrieving logs
type GetRequest struct {
	Lines  int    `json:"lines,omitempty"`
	Source string `json:"source,omitempty"`
	Since  string `json:"since,omitempty"`
	// CommandID, when non-zero, restricts results to log entries with a
	// matching CommandID. Combine with Source="exec" to scope to a single
	// /exec invocation.
	CommandID uint64 `json:"command_id,omitempty"`
}

// GetResponse contains retrieved logs
type GetResponse struct {
	Logs  []LogEntry `json:"logs"`
	Total int        `json:"total"`
}

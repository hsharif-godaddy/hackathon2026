package logs

import "time"

// LogEntry represents a log entry
type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Source    string    `json:"source"`
	Message   string    `json:"message"`
	Level     string    `json:"level,omitempty"`
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
}

// GetResponse contains retrieved logs
type GetResponse struct {
	Logs  []LogEntry `json:"logs"`
	Total int        `json:"total"`
}

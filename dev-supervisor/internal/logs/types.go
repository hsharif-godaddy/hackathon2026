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

// internal/logging/audit.go
package logging

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type AuditEntry struct {
	Timestamp      time.Time   `json:"timestamp"`
	Event          string      `json:"event"`
	SubscriptionID string      `json:"subscriptionId"`
	BudgetID       string      `json:"budgetId,omitempty"`
	Amount         string      `json:"amount,omitempty"`       // Precise decimal amount
	BalanceAfter   int64       `json:"balanceAfter,omitempty"` // Rounded value
	OperationType  string      `json:"operationType,omitempty"`
	OperationID    string      `json:"operationId,omitempty"`
	Metadata       interface{} `json:"metadata,omitempty"`
}

type AuditLogger struct {
	file        *os.File
	mu          sync.Mutex
	syncEnabled bool
}

// NewAuditLogger creates an audit logger that writes to the specified path.
// If syncEnabled is true, each log entry is synced to disk immediately for durability.
// Disabling sync improves performance but entries may be lost on crash.
func NewAuditLogger(path string, syncEnabled bool) (*AuditLogger, error) {
	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, fmt.Errorf("failed to create log directory: %w", err)
	}

	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open audit log: %w", err)
	}

	return &AuditLogger{file: file, syncEnabled: syncEnabled}, nil
}

func (l *AuditLogger) Log(entry AuditEntry) error {
	entry.Timestamp = time.Now()

	data, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("failed to marshal audit entry: %w", err)
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if _, err := l.file.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("failed to write audit entry: %w", err)
	}

	// Sync to disk for compliance requirements (configurable for performance)
	if l.syncEnabled {
		if err := l.file.Sync(); err != nil {
			return fmt.Errorf("failed to sync audit entry: %w", err)
		}
	}

	return nil
}

func (l *AuditLogger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := l.file.Sync(); err != nil {
		return fmt.Errorf("failed to sync audit log on close: %w", err)
	}
	return l.file.Close()
}

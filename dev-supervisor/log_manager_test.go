package main

import (
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
)

func TestLogManager_NewLogManager(t *testing.T) {
	t.Parallel()
	// Test with custom max logs
	maxLogs := 500
	lm := NewLogManager(maxLogs)

	if lm == nil {
		t.Fatal("Expected non-nil LogManager")
		return
	}

	if lm.maxLogs != maxLogs {
		t.Errorf("Expected maxLogs %d, got %d", maxLogs, lm.maxLogs)
	}

	if lm.logs == nil {
		t.Error("Expected logs slice to be initialized")
	}

	if len(lm.logs) != 0 {
		t.Error("Expected empty logs initially")
	}

	// Test with invalid max logs (should use default)
	lm2 := NewLogManager(-1)
	if lm2.maxLogs != 10000 {
		t.Errorf("Expected default maxLogs 10000, got %d", lm2.maxLogs)
	}
}

func TestLogManager_AddLog(t *testing.T) {
	t.Parallel()
	lm := NewLogManager(100)

	// Add a single log entry
	entry := logs.LogEntry{
		Timestamp: time.Now(),
		Source:    "test",
		Message:   "test message",
		Level:     "info",
	}

	lm.AddLog(entry)

	logs, err := lm.GetLogs(LogsGetRequest{})
	if err != nil {
		t.Fatalf("Failed to get logs: %v", err)
	}

	if len(logs.Logs) != 1 {
		t.Errorf("Expected 1 log entry, got %d", len(logs.Logs))
	}

	if logs.Logs[0].Message != entry.Message {
		t.Errorf("Expected message '%s', got '%s'", entry.Message, logs.Logs[0].Message)
	}

	if logs.Logs[0].Source != entry.Source {
		t.Errorf("Expected source '%s', got '%s'", entry.Source, logs.Logs[0].Source)
	}
}

func TestLogManager_AddMultipleLogs(t *testing.T) {
	t.Parallel()
	lm := NewLogManager(100)

	// Add multiple log entries
	entries := []logs.LogEntry{
		{
			Timestamp: time.Now().Add(-2 * time.Second),
			Source:    "stdout",
			Message:   "first message",
			Level:     "info",
		},
		{
			Timestamp: time.Now().Add(-1 * time.Second),
			Source:    "stderr",
			Message:   "error message",
			Level:     "error",
		},
		{
			Timestamp: time.Now(),
			Source:    "stdout",
			Message:   "latest message",
			Level:     "info",
		},
	}

	for _, entry := range entries {
		lm.AddLog(entry)
	}

	logs, err := lm.GetLogs(LogsGetRequest{})
	if err != nil {
		t.Fatalf("Failed to get logs: %v", err)
	}

	if len(logs.Logs) != len(entries) {
		t.Errorf("Expected %d log entries, got %d", len(entries), len(logs.Logs))
	}

	// Verify order and content
	for i, entry := range entries {
		if logs.Logs[i].Message != entry.Message {
			t.Errorf("Expected message '%s' at index %d, got '%s'", entry.Message, i, logs.Logs[i].Message)
		}
	}
}

func TestLogManager_LogBufferTrimming(t *testing.T) {
	t.Parallel()
	// Create log manager with small buffer
	maxLogs := 10
	lm := NewLogManager(maxLogs)

	// Add more logs than the buffer can hold
	numLogs := 20
	for i := range numLogs {
		entry := logs.LogEntry{
			Timestamp: time.Now().Add(time.Duration(i) * time.Millisecond),
			Source:    "test",
			Message:   fmt.Sprintf("message %d", i),
			Level:     "info",
		}
		lm.AddLog(entry)
	}

	logs, err := lm.GetLogs(LogsGetRequest{})
	if err != nil {
		t.Fatalf("Failed to get logs: %v", err)
	}

	// Buffer should not exceed maxLogs
	if len(logs.Logs) > maxLogs {
		t.Errorf("Expected at most %d logs, got %d", maxLogs, len(logs.Logs))
	}

	// Should contain the most recent logs
	if len(logs.Logs) > 0 {
		lastLog := logs.Logs[len(logs.Logs)-1]
		if lastLog.Message != fmt.Sprintf("message %d", numLogs-1) {
			t.Errorf("Expected last message to be 'message %d', got '%s'", numLogs-1, lastLog.Message)
		}
	}
}

func TestLogManager_GetLogs(t *testing.T) {
	t.Parallel()
	lm := NewLogManager(100)

	// Add test logs with different sources
	testLogs := []logs.LogEntry{
		{Timestamp: time.Now().Add(-5 * time.Second), Source: "stdout", Message: "stdout message 1", Level: "info"},
		{Timestamp: time.Now().Add(-4 * time.Second), Source: "stderr", Message: "stderr message 1", Level: "error"},
		{Timestamp: time.Now().Add(-3 * time.Second), Source: "stdout", Message: "stdout message 2", Level: "info"},
		{Timestamp: time.Now().Add(-2 * time.Second), Source: "stderr", Message: "stderr message 2", Level: "warn"},
		{Timestamp: time.Now().Add(-1 * time.Second), Source: "stdout", Message: "stdout message 3", Level: "info"},
	}

	for _, entry := range testLogs {
		lm.AddLog(entry)
	}

	tests := []struct {
		name          string
		request       LogsGetRequest
		expectedCount int
		validateFunc  func(logs []logs.LogEntry) error
	}{
		{
			name:          "get all logs",
			request:       LogsGetRequest{},
			expectedCount: 5,
		},
		{
			name:          "limit logs",
			request:       LogsGetRequest{Lines: 3},
			expectedCount: 3,
			validateFunc: func(logs []logs.LogEntry) error {
				// Should get the last 3 logs
				if logs[len(logs)-1].Message != "stdout message 3" {
					return fmt.Errorf(
						"expected last message to be 'stdout message 3', got '%s'",
						logs[len(logs)-1].Message,
					)
				}
				return nil
			},
		},
		{
			name:          "filter by source",
			request:       LogsGetRequest{Source: "stdout"},
			expectedCount: 3,
			validateFunc: func(logs []logs.LogEntry) error {
				for _, log := range logs {
					if log.Source != "stdout" {
						return fmt.Errorf("expected only stdout logs, got source: %s", log.Source)
					}
				}
				return nil
			},
		},
		{
			name:          "filter by source with limit",
			request:       LogsGetRequest{Source: "stderr", Lines: 1},
			expectedCount: 1,
			validateFunc: func(logs []logs.LogEntry) error {
				if logs[0].Source != "stderr" {
					return fmt.Errorf("expected stderr log, got source: %s", logs[0].Source)
				}
				if logs[0].Message != "stderr message 2" {
					return fmt.Errorf("expected 'stderr message 2', got: %s", logs[0].Message)
				}
				return nil
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			logs, err := lm.GetLogs(tt.request)
			if err != nil {
				t.Fatalf("Failed to get logs: %v", err)
			}

			if len(logs.Logs) != tt.expectedCount {
				t.Errorf("Expected %d logs, got %d", tt.expectedCount, len(logs.Logs))
			}

			if logs.Total != tt.expectedCount {
				t.Errorf("Expected total %d, got %d", tt.expectedCount, logs.Total)
			}

			if tt.validateFunc != nil {
				if err := tt.validateFunc(logs.Logs); err != nil {
					t.Errorf("Validation failed: %v", err)
				}
			}
		})
	}
}

func TestLogManagerConcurrentAccess(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		lm := NewLogManager(100)
		const workers = 4
		const entriesPerWorker = 5

		var wg sync.WaitGroup

		for workerID := range workers {
			wg.Go(func() {
				for entry := range entriesPerWorker {
					lm.AddLog(logs.LogEntry{
						Timestamp: time.Now(),
						Source:    fmt.Sprintf("worker-%d", workerID),
						Message:   fmt.Sprintf("log-%d", entry),
						Level:     "info",
					})
					time.Sleep(5 * time.Millisecond)
				}
			})
		}

		wg.Wait()
		synctest.Wait()

		resp, err := lm.GetLogs(LogsGetRequest{})
		if err != nil {
			t.Fatalf("failed to get logs: %v", err)
		}

		expected := workers * entriesPerWorker
		if len(resp.Logs) != expected {
			t.Fatalf("expected %d logs, got %d", expected, len(resp.Logs))
		}

		if resp.Logs[len(resp.Logs)-1].Source == "" {
			t.Fatalf("expected last log to have a source, got empty string")
		}
	})
}

func TestLogManager_GetLogsWithSince(t *testing.T) {
	t.Parallel()
	lm := NewLogManager(100)

	baseTime := time.Now().Add(-10 * time.Second)

	// Add logs at different times
	testLogs := []logs.LogEntry{
		{Timestamp: baseTime.Add(1 * time.Second), Source: "test", Message: "message 1", Level: "info"},
		{Timestamp: baseTime.Add(2 * time.Second), Source: "test", Message: "message 2", Level: "info"},
		{Timestamp: baseTime.Add(3 * time.Second), Source: "test", Message: "message 3", Level: "info"},
		{Timestamp: baseTime.Add(4 * time.Second), Source: "test", Message: "message 4", Level: "info"},
	}

	for _, entry := range testLogs {
		lm.AddLog(entry)
	}

	// Test filtering by since timestamp - use a whole second to avoid precision issues
	sinceTime := baseTime.Add(2*time.Second + 1*time.Nanosecond) // Just after message 2

	request := LogsGetRequest{
		Since: sinceTime.Format(time.RFC3339Nano),
	}

	logs, err := lm.GetLogs(request)
	if err != nil {
		t.Fatalf("Failed to get logs: %v", err)
	}

	// Should get messages 3 and 4
	expectedCount := 2
	if len(logs.Logs) != expectedCount {
		t.Errorf("Expected %d logs after since filter, got %d", expectedCount, len(logs.Logs))
	}

	if len(logs.Logs) >= 1 && logs.Logs[0].Message != "message 3" {
		t.Errorf("Expected first log to be 'message 3', got '%s'", logs.Logs[0].Message)
	}
}

func TestLogManager_GetLogsInvalidSince(t *testing.T) {
	t.Parallel()
	lm := NewLogManager(100)

	request := LogsGetRequest{
		Since: "invalid-timestamp",
	}

	_, err := lm.GetLogs(request)
	if err == nil {
		t.Error("Expected error for invalid since timestamp")
	}
}

func TestLogManager_GetStats(t *testing.T) {
	t.Parallel()
	lm := NewLogManager(100)

	// Test with empty logs
	stats := lm.GetStats()

	expectedFields := []string{"total_logs", "max_logs"}
	for _, field := range expectedFields {
		if _, exists := stats[field]; !exists {
			t.Errorf("Expected field %s in stats", field)
		}
	}

	if stats["total_logs"] != 0 {
		t.Errorf("Expected total_logs 0, got %v", stats["total_logs"])
	}

	if stats["max_logs"] != 100 {
		t.Errorf("Expected max_logs 100, got %v", stats["max_logs"])
	}

	// Add some logs and test again
	for i := range 5 {
		entry := logs.LogEntry{
			Timestamp: time.Now(),
			Source:    "test",
			Message:   fmt.Sprintf("message %d", i),
		}
		lm.AddLog(entry)
	}

	stats = lm.GetStats()
	if stats["total_logs"] != 5 {
		t.Errorf("Expected total_logs 5, got %v", stats["total_logs"])
	}
}

func TestLogManager_ParseLogsGetRequest(t *testing.T) {
	t.Parallel()
	lm := NewLogManager(100)

	tests := []struct {
		name           string
		queryParams    map[string]string
		expectedLines  int
		expectedSource string
		expectedSince  string
	}{
		{
			name:          "empty request",
			queryParams:   map[string]string{},
			expectedLines: 0,
		},
		{
			name: "with lines parameter",
			queryParams: map[string]string{
				"lines": "50",
			},
			expectedLines: 50,
		},
		{
			name: "with source parameter",
			queryParams: map[string]string{
				"source": "stdout",
			},
			expectedSource: "stdout",
		},
		{
			name: "with since parameter",
			queryParams: map[string]string{
				"since": "2023-01-01T10:00:00Z",
			},
			expectedSince: "2023-01-01T10:00:00Z",
		},
		{
			name: "with all parameters",
			queryParams: map[string]string{
				"lines":  "25",
				"source": "stderr",
				"since":  "2023-01-01T10:00:00Z",
			},
			expectedLines:  25,
			expectedSource: "stderr",
			expectedSince:  "2023-01-01T10:00:00Z",
		},
		{
			name: "invalid lines parameter",
			queryParams: map[string]string{
				"lines": "invalid",
			},
			expectedLines: 0, // Should default to 0 for invalid input
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			// Create mock HTTP request
			req := &http.Request{
				URL: &url.URL{},
			}

			// Set query parameters
			query := req.URL.Query()
			for key, value := range tt.queryParams {
				query.Set(key, value)
			}
			req.URL.RawQuery = query.Encode()

			// Parse request
			parsedReq := lm.parseLogsGetRequest(req)

			if parsedReq.Lines != tt.expectedLines {
				t.Errorf("Expected lines %d, got %d", tt.expectedLines, parsedReq.Lines)
			}

			if parsedReq.Source != tt.expectedSource {
				t.Errorf("Expected source '%s', got '%s'", tt.expectedSource, parsedReq.Source)
			}

			if parsedReq.Since != tt.expectedSince {
				t.Errorf("Expected since '%s', got '%s'", tt.expectedSince, parsedReq.Since)
			}
		})
	}
}

func TestLogManager_ConcurrentAccess(t *testing.T) {
	t.Parallel()
	lm := NewLogManager(1000)

	// Test concurrent writes
	numGoroutines := 10
	logsPerGoroutine := 100

	done := make(chan bool, numGoroutines)

	for i := range numGoroutines {
		go func(goroutineID int) {
			defer func() { done <- true }()

			for j := range logsPerGoroutine {
				entry := logs.LogEntry{
					Timestamp: time.Now(),
					Source:    fmt.Sprintf("goroutine-%d", goroutineID),
					Message:   fmt.Sprintf("message %d from goroutine %d", j, goroutineID),
					Level:     "info",
				}
				lm.AddLog(entry)
			}
		}(i)
	}

	// Wait for all goroutines to complete
	for range numGoroutines {
		<-done
	}

	// Verify logs were added (some might be trimmed due to buffer size)
	result, err := lm.GetLogs(LogsGetRequest{})
	if err != nil {
		t.Fatalf("Failed to get logs: %v", err)
	}

	if len(result.Logs) == 0 {
		t.Error("Expected some logs after concurrent writes")
	}

	// Test concurrent reads while writing
	readDone := make(chan bool, 5)
	writeDone := make(chan bool, 2)

	// Start readers
	for range 5 {
		go func() {
			defer func() { readDone <- true }()

			for range 10 {
				_, err := lm.GetLogs(LogsGetRequest{Lines: 50})
				if err != nil {
					t.Errorf("Concurrent read failed: %v", err)
				}
				time.Sleep(1 * time.Millisecond)
			}
		}()
	}

	// Start writers
	for i := range 2 {
		go func(writerID int) {
			defer func() { writeDone <- true }()

			for j := range 50 {
				entry := logs.LogEntry{
					Timestamp: time.Now(),
					Source:    fmt.Sprintf("concurrent-writer-%d", writerID),
					Message:   fmt.Sprintf("concurrent message %d", j),
					Level:     "info",
				}
				lm.AddLog(entry)
				time.Sleep(1 * time.Millisecond)
			}
		}(i)
	}

	// Wait for all concurrent operations
	for range 5 {
		<-readDone
	}
	for range 2 {
		<-writeDone
	}

	// Verify system is still functional
	finalStats := lm.GetStats()
	if totalLogs, ok := finalStats["total_logs"].(int); !ok || totalLogs == 0 {
		t.Error("Expected some logs after concurrent operations")
	}
}

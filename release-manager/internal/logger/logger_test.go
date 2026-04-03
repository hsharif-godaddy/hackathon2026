package logger

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func resetLogger() {
	mu.Lock()
	if file != nil {
		file.Close()
	}
	file = nil
	mu.Unlock()
}

func TestInitCreatesDirectoryAndFile(t *testing.T) {
	defer resetLogger()

	dir := filepath.Join(t.TempDir(), "logs")
	if err := Init(dir); err != nil {
		t.Fatalf("Init() error: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("reading dir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d files, want 1", len(entries))
	}
	if !strings.HasPrefix(entries[0].Name(), "release-") || !strings.HasSuffix(entries[0].Name(), ".log") {
		t.Errorf("unexpected filename: %s", entries[0].Name())
	}
}

func TestInitWritesStartupHeader(t *testing.T) {
	defer resetLogger()

	dir := t.TempDir()
	if err := Init(dir); err != nil {
		t.Fatalf("Init() error: %v", err)
	}

	Close()

	entries, _ := os.ReadDir(dir)
	content, err := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	if err != nil {
		t.Fatalf("reading log: %v", err)
	}

	if !strings.Contains(string(content), "Release Manager started") {
		t.Errorf("startup header not found in log: %q", string(content))
	}
}

func TestLogWritesTimestampedLine(t *testing.T) {
	defer resetLogger()

	dir := t.TempDir()
	if err := Init(dir); err != nil {
		t.Fatalf("Init() error: %v", err)
	}

	Log("test message: %s=%d", "key", 42)
	Close()

	entries, _ := os.ReadDir(dir)
	content, err := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	if err != nil {
		t.Fatalf("reading log: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(content)), "\n")
	lastLine := lines[len(lines)-1]

	if !strings.Contains(lastLine, " | ") {
		t.Errorf("missing timestamp separator in line: %q", lastLine)
	}
	if !strings.Contains(lastLine, "test message: key=42") {
		t.Errorf("message not found in line: %q", lastLine)
	}
}

func TestLogNoopWithoutInit(t *testing.T) {
	defer resetLogger()

	// Should not panic when file is nil.
	Log("this should be safe without Init")
}

func TestCloseAllowsSubsequentLogWithoutPanic(t *testing.T) {
	defer resetLogger()

	dir := t.TempDir()
	Init(dir)
	Close()

	// Logging after Close should silently do nothing.
	Log("after close")
}

func TestCloseIdempotent(t *testing.T) {
	defer resetLogger()

	dir := t.TempDir()
	Init(dir)
	Close()
	Close()
}

func TestLogConcurrentSafety(t *testing.T) {
	defer resetLogger()

	dir := t.TempDir()
	if err := Init(dir); err != nil {
		t.Fatalf("Init() error: %v", err)
	}

	var wg sync.WaitGroup
	for i := range 50 {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			Log("concurrent write %d", n)
		}(i)
	}
	wg.Wait()
	Close()

	entries, _ := os.ReadDir(dir)
	content, err := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	if err != nil {
		t.Fatalf("reading log: %v", err)
	}

	// 1 startup header + 50 concurrent writes = 51 lines.
	lines := strings.Split(strings.TrimSpace(string(content)), "\n")
	if len(lines) != 51 {
		t.Errorf("got %d lines, want 51", len(lines))
	}
}

func TestInitFailsOnBadDirectory(t *testing.T) {
	defer resetLogger()

	err := Init("/proc/nonexistent/impossible/path")
	if err == nil {
		t.Fatal("expected error for impossible path")
	}
}

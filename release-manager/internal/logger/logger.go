package logger

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	mu   sync.Mutex
	file *os.File
)

func Init(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating log directory: %w", err)
	}

	name := fmt.Sprintf("release-%s.log", time.Now().Format("2006-01-02_15-04-05"))
	f, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		return fmt.Errorf("creating log file: %w", err)
	}

	mu.Lock()
	file = f
	mu.Unlock()

	Log("=== Release Manager started at %s ===", time.Now().Format(time.RFC3339))
	return nil
}

func Log(format string, args ...any) {
	mu.Lock()
	defer mu.Unlock()

	if file == nil {
		return
	}

	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(file, "%s | %s\n", time.Now().Format("2006-01-02 15:04:05"), msg)
}

func Close() {
	mu.Lock()
	defer mu.Unlock()

	if file != nil {
		file.Close()
		file = nil
	}
}

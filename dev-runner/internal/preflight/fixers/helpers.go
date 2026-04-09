package fixers

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// upsertEnvVar adds or replaces a key in a .env file, wrapping the value in
// double quotes. Uses atomic temp-file + rename to avoid partial writes.
func upsertEnvVar(path string, key string, value string) error {
	content, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	quotedValue := `"` + value + `"`
	newLine := key + "=" + quotedValue

	lines := strings.Split(string(content), "\n")
	found := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, key+"=") {
			lines[i] = newLine
			found = true
			break
		}
	}

	if !found {
		lines = append(lines, "", newLine)
	}

	return writeEnvLines(path, lines)
}

// upsertEnvVarUnquoted adds or replaces a key in a .env file without quoting
// the value. Uses atomic temp-file + rename to avoid partial writes.
func upsertEnvVarUnquoted(path string, key string, value string) error {
	content, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	newLine := key + "=" + value

	lines := strings.Split(string(content), "\n")
	found := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, key+"=") {
			lines[i] = newLine
			found = true
			break
		}
	}

	if !found {
		lines = append(lines, "", newLine)
	}

	return writeEnvLines(path, lines)
}

// writeEnvLines atomically writes lines to a file via temp-file + rename.
func writeEnvLines(path string, lines []string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("creating directory %s: %w", dir, err)
	}

	tmp, err := os.CreateTemp(dir, ".env.tmp.*")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()

	if _, err := tmp.WriteString(strings.Join(lines, "\n")); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("closing temp file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("renaming temp file: %w", err)
	}

	return nil
}

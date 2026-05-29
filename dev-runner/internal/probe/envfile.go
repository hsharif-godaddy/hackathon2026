package probe

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strings"
)

// EnvLine represents a single line from a .env file. Comment and blank lines
// have an empty Key; key=value lines populate both Key and Value.
type EnvLine struct {
	Raw   string // original line text (used for comment and blank lines on write)
	Key   string // empty for comment/blank lines
	Value string // unquoted value; empty string is a valid value
}

// ParseEnvFile reads the .env file at path and returns a slice of EnvLine
// preserving every line in order (including comments and blank lines).
//
// Supported formats: KEY=VALUE, KEY="VALUE", KEY='VALUE'.
// Lines that do not contain '=' (and are not comments/blanks) are kept as Raw.
func ParseEnvFile(path string) ([]EnvLine, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("envfile: open %q: %w", path, err)
	}
	defer f.Close()

	var lines []EnvLine
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		raw := scanner.Text()
		trimmed := strings.TrimSpace(raw)

		// Blank line or comment — preserve as-is.
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			lines = append(lines, EnvLine{Raw: raw})
			continue
		}

		idx := strings.IndexByte(trimmed, '=')
		if idx < 0 {
			// Not a key=value line; preserve raw.
			lines = append(lines, EnvLine{Raw: raw})
			continue
		}

		key := strings.TrimSpace(trimmed[:idx])
		value := trimmed[idx+1:]

		// Strip optional surrounding quotes (single or double).
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}

		lines = append(lines, EnvLine{Raw: raw, Key: key, Value: value})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("envfile: scan %q: %w", path, err)
	}
	return lines, nil
}

// WriteEnvFile writes lines back to path, preserving comments and blank lines.
// Key-value lines are written as KEY=VALUE (quoted if the value contains spaces).
//
// The write is atomic: content is written to a temporary file, fsynced, then
// renamed over the target path so a crash mid-write cannot corrupt the file.
func WriteEnvFile(path string, lines []EnvLine) error {
	tmp := path + ".tmp"

	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("envfile: create %q: %w", tmp, err)
	}

	w := bufio.NewWriter(f)
	for _, l := range lines {
		if l.Key != "" {
			if _, err := fmt.Fprintf(w, "%s=%s\n", l.Key, quoteEnvValue(l.Value)); err != nil {
				f.Close()
				os.Remove(tmp)
				return err
			}
		} else {
			if _, err := fmt.Fprintf(w, "%s\n", l.Raw); err != nil {
				f.Close()
				os.Remove(tmp)
				return err
			}
		}
	}

	if err := w.Flush(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}

	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("envfile: rename %q -> %q: %w", tmp, path, err)
	}
	return nil
}

// UpdateEnvFile reads the .env file at path (or creates it if absent), updates
// the first line matching key, and writes the file back. If no matching key is
// found a new line is appended. Comments and blank lines are preserved.
func UpdateEnvFile(path string, key, value string) error {
	var lines []EnvLine

	existing, err := ParseEnvFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil {
		lines = existing
	}

	// Try to update an existing entry.
	for i, l := range lines {
		if l.Key == key {
			lines[i].Value = value
			return WriteEnvFile(path, lines)
		}
	}

	// Key not found — append.
	lines = append(lines, EnvLine{Key: key, Value: value})
	return WriteEnvFile(path, lines)
}

// EnvLinesToMap returns a map of key → value from lines that have a non-empty Key.
func EnvLinesToMap(lines []EnvLine) map[string]string {
	m := make(map[string]string, len(lines))
	for _, l := range lines {
		if l.Key != "" {
			m[l.Key] = l.Value
		}
	}
	return m
}

// sensitiveKeyParts lists substrings that mark an env key as sensitive.
// Matching is case-insensitive.
var sensitiveKeyParts = []string{"KEY", "SECRET", "TOKEN", "PASSWORD", "PASS"}

// MaskSensitiveValue returns "***" if the key name matches a sensitive pattern
// and the value is non-empty. Non-sensitive keys and empty values are returned
// unchanged.
func MaskSensitiveValue(key, value string) string {
	if value == "" {
		return value
	}
	upper := strings.ToUpper(key)
	for _, part := range sensitiveKeyParts {
		if strings.Contains(upper, part) {
			return "***"
		}
	}
	return value
}

// quoteEnvValue wraps value in double-quotes if it contains whitespace.
func quoteEnvValue(value string) string {
	if strings.ContainsAny(value, " \t") {
		return `"` + value + `"`
	}
	return value
}

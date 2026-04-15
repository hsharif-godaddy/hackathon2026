package preflight

import (
	"bufio"
	"os"
	"strings"
)

// ParseEnvFile reads a .env file and returns a map of key -> value.
// Supports:
//   - KEY=VALUE
//   - KEY="VALUE"
//   - KEY='VALUE'
//
// Ignores blank lines and lines starting with #.
func ParseEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	result := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if k, v, ok := parseEnvLine(line); ok {
			result[k] = v
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// parseEnvLine parses a single line from a .env file.
// Returns (key, value, true) on success, ("", "", false) otherwise.
func parseEnvLine(line string) (string, string, bool) {
	trimmed := strings.TrimSpace(line)
	// Skip blanks and comments.
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return "", "", false
	}

	idx := strings.IndexByte(trimmed, '=')
	if idx < 0 {
		return "", "", false
	}

	key := strings.TrimSpace(trimmed[:idx])
	if key == "" {
		return "", "", false
	}

	value := trimmed[idx+1:]

	// Strip optional surrounding quotes (single or double).
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			value = value[1 : len(value)-1]
		}
	}

	return key, value, true
}

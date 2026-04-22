package projectenv

import (
	"os"
	"path/filepath"
	"strings"
)

// Resolve returns a project configuration value using this precedence:
//  1. Current process environment
//  2. app/.env
//  3. app/.env.local.dev
//  4. agents/.env
//  5. agents/.env.local.dev
func Resolve(key string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}

	projectRoot := os.Getenv("PROJECT_ROOT")
	if projectRoot == "" {
		projectRoot = ".."
	}

	candidatePaths := []string{
		filepath.Join(projectRoot, "app", ".env"),
		filepath.Join(projectRoot, "app", ".env.local.dev"),
		filepath.Join(projectRoot, "agents", ".env"),
		filepath.Join(projectRoot, "agents", ".env.local.dev"),
	}

	for _, path := range candidatePaths {
		if v := ReadDotenvValue(path, key); v != "" {
			return v
		}
	}

	return ""
}

// ReadDotenvValue parses a single key from a dotenv file.
// Lines starting with '#' are skipped. Returns "" if not found
// or if the file cannot be read.
func ReadDotenvValue(filePath, key string) string {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return ""
	}
	prefix := key + "="
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, prefix) {
			val := strings.TrimPrefix(line, prefix)
			if idx := strings.Index(val, " #"); idx != -1 {
				val = val[:idx]
			}
			val = strings.Trim(val, `"'`)
			return strings.TrimSpace(val)
		}
	}
	return ""
}

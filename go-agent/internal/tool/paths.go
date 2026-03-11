package tool

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// ValidatePath ensures relPath resolves within appRoot and returns the absolute path.
// It rejects absolute paths and path traversal attempts (e.g. "../../../etc").
func ValidatePath(appRoot, relPath string) (string, error) {
	if relPath == "" {
		return "", errors.New("path is required")
	}
	cleaned := filepath.Clean(relPath)
	if filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("path must be relative: %s", relPath)
	}
	abs := filepath.Join(appRoot, cleaned)
	rel, err := filepath.Rel(appRoot, abs)
	if err != nil {
		return "", fmt.Errorf("path outside app directory: %s", relPath)
	}
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return "", fmt.Errorf("path outside app directory: %s", relPath)
	}
	return abs, nil
}

// BlockedNames are file/directory names that should never be read or written by tools.
var BlockedNames = map[string]bool{
	"package-lock.json": true,
	"pnpm-lock.yaml":    true,
	"yarn.lock":         true,
	"composer.lock":     true,
}

// BlockedDirs are directory path segments that indicate blocked content.
var BlockedDirs = map[string]bool{
	"node_modules":  true,
	"vendor":        true,
	".pnpm":         true,
	".yarn":         true,
	".cache":        true,
	".vite":         true,
	".turbo":        true,
	".parcel-cache": true,
}

// BlockedExtensions are file extensions for binary/log files that should not be read or written.
var BlockedExtensions = map[string]bool{
	".log":     true,
	".zip":     true,
	".tar":     true,
	".gz":      true,
	".rar":     true,
	".7z":      true,
	".db":      true,
	".sqlite":  true,
	".sqlite3": true,
	".bin":     true,
	".exe":     true,
	".dll":     true,
	".so":      true,
}

// CheckBlocked returns an error if the path matches a blocked pattern.
func CheckBlocked(relPath string) error {
	base := filepath.Base(relPath)
	if BlockedNames[base] {
		return fmt.Errorf("file blocked: %s", base)
	}
	ext := filepath.Ext(base)
	if BlockedExtensions[ext] {
		return fmt.Errorf("file blocked: %s extension", ext)
	}
	for part := range strings.SplitSeq(filepath.ToSlash(relPath), "/") {
		if BlockedDirs[part] {
			return fmt.Errorf("file blocked: inside %s directory", part)
		}
	}
	return nil
}

// IgnoredDirs are directory names commonly skipped during file traversal.
var IgnoredDirs = map[string]bool{
	"node_modules":  true,
	".git":          true,
	".svn":          true,
	".hg":           true,
	"vendor":        true,
	"dist":          true,
	"build":         true,
	"out":           true,
	"target":        true,
	".next":         true,
	".nuxt":         true,
	".vscode":       true,
	".idea":         true,
	".cache":        true,
	".parcel-cache": true,
	"coverage":      true,
	".nyc_output":   true,
	"__pycache__":   true,
	".pytest_cache": true,
	".mypy_cache":   true,
	"venv":          true,
	".turbo":        true,
	".pnpm":         true,
	".yarn":         true,
	".vite":         true,
}

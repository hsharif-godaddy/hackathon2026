package middleware

import "strings"

// IsPathExcluded checks if a request path matches any excluded path
// Used by both JWT middleware and activity tracking middleware for consistency
func IsPathExcluded(path string, excludedPaths []string) bool {
	for _, excluded := range excludedPaths {
		// Exclude exact path matches
		if path == excluded {
			return true
		}

		// For directory-style exclusions (ending with "/"), use prefix matching.
		// This avoids unintentionally excluding paths like "/healthcheck" when
		// only "/health" is configured as an excluded path.
		if strings.HasSuffix(excluded, "/") && strings.HasPrefix(path, excluded) {
			return true
		}
	}
	return false
}

package process

import "strings"

// Scanner checks output lines against error patterns.
type Scanner struct {
	patterns []string
}

// NewScanner creates a Scanner from a list of error pattern strings.
func NewScanner(patterns []string) *Scanner {
	lower := make([]string, len(patterns))
	for i, p := range patterns {
		lower[i] = strings.ToLower(p)
	}
	return &Scanner{patterns: lower}
}

// IsError returns true if the line matches any error pattern.
func (s *Scanner) IsError(line string) bool {
	if len(s.patterns) == 0 {
		return false
	}
	lower := strings.ToLower(line)
	for _, p := range s.patterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

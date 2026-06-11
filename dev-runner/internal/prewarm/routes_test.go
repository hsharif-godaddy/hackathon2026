package prewarm

import (
	"strings"
	"testing"
)

func TestRoutesWellFormed(t *testing.T) {
	// Lower bound rather than an exact count: a brittle `== N` check fails on
	// every legitimate route add/remove. The dedupe/prefix checks below are the
	// valuable invariants; this just guards against accidental truncation.
	if len(Routes) < 20 {
		t.Fatalf("len(Routes) = %d, suspiciously low (truncated?)", len(Routes))
	}
	seen := map[string]bool{}
	for _, r := range Routes {
		if !strings.HasPrefix(r, "/") {
			t.Errorf("route %q is not an absolute path", r)
		}
		if strings.Contains(r, " ") {
			t.Errorf("route %q contains a space", r)
		}
		if seen[r] {
			t.Errorf("duplicate route %q", r)
		}
		seen[r] = true
	}
}

package process

import "testing"

func TestScanner_IsError(t *testing.T) {
	s := NewScanner([]string{"ERROR", "FATAL", "panic:"})

	tests := []struct {
		line string
		want bool
	}{
		{"normal log output", false},
		{"2024-01-01 ERROR something bad", true},
		{"FATAL: cannot connect", true},
		{"goroutine 1 [running]: panic: oh no", true},
		{"error handling is fine", true},
		{"Info: all good", false},
		{"", false},
	}

	for _, tt := range tests {
		got := s.IsError(tt.line)
		if got != tt.want {
			t.Errorf("IsError(%q) = %v, want %v", tt.line, got, tt.want)
		}
	}
}

func TestScanner_EmptyPatterns(t *testing.T) {
	s := NewScanner(nil)
	if s.IsError("ERROR something") {
		t.Error("expected false for empty patterns")
	}
}

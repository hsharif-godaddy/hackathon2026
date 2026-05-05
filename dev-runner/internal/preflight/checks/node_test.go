package checks

import (
	"testing"
)

func TestParseVersion(t *testing.T) {
	tests := []struct {
		input     string
		wantMajor int
		wantMinor int
		wantPatch int
	}{
		{"22.22.2", 22, 22, 2},
		{"22.16.0", 22, 16, 0},
		{"20.0.0", 20, 0, 0},
		{"22.16.0-rc1", 22, 16, 0},
		{"1.25.7", 1, 25, 7},
	}

	for _, tt := range tests {
		major, minor, patch := parseVersion(tt.input)
		if major != tt.wantMajor || minor != tt.wantMinor || patch != tt.wantPatch {
			t.Errorf("parseVersion(%q) = (%d, %d, %d), want (%d, %d, %d)",
				tt.input, major, minor, patch, tt.wantMajor, tt.wantMinor, tt.wantPatch)
		}
	}
}

package docker

import (
	"testing"
)

func TestIsValidAppID(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		{"valid nanoid", "abc123defg", true},
		{"all digits", "1234567890", true},
		{"all lowercase", "abcdefghij", true},
		{"too short", "abc123", false},
		{"too long", "abc123defghij", false},
		{"empty", "", false},
		{"uppercase", "ABC123DEFG", false},
		{"hyphen", "abc-123def", false},
		{"underscore", "abc_123def", false},
		{"special chars", "abc!@#defg", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidAppID(tt.input)
			if got != tt.expected {
				t.Errorf("isValidAppID(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestExtractAppID(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"preview container", "preview-abc123defg-1", "abc123defg"},
		{"publish container", "publish-abc123defg-1", "abc123defg"},
		{"unrelated container", "redis-server", ""},
		{"airo mysql container", "airo-app-mysql", ""},
		{"missing suffix", "preview-abc123defg", ""},
		{"missing prefix", "abc123defg-1", ""},
		{"empty string", "", ""},
		{"only prefix", "preview-", ""},
		{"only suffix", "-1", ""},
		{"preview prefix without suffix", "preview-abc", ""},
		{"publish with trailing text", "publish-abc-1-extra", ""},
		{"empty id between delimiters", "preview--1", ""},
		{"short id rejected", "preview-abc-1", ""},
		{"id with hyphens rejected", "preview-abc-123def-1", ""},
		{"uppercase id rejected", "preview-ABC123DEFG-1", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractAppID(tt.input)
			if got != tt.expected {
				t.Errorf("extractAppID(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseContainerAppIDs(t *testing.T) {
	t.Run("mixed containers", func(t *testing.T) {
		output := "preview-abc123defg-1\npublish-abc123defg-1\npreview-xyz987lmno-1\nredis-server\nairo-app-mysql\n"
		ids := parseContainerAppIDs(output)

		if len(ids) != 2 {
			t.Fatalf("expected 2 unique app IDs, got %d: %v", len(ids), ids)
		}

		idSet := map[string]bool{}
		for _, id := range ids {
			idSet[id] = true
		}
		if !idSet["abc123defg"] {
			t.Error("expected abc123defg in results")
		}
		if !idSet["xyz987lmno"] {
			t.Error("expected xyz987lmno in results")
		}
	})

	t.Run("deduplication", func(t *testing.T) {
		output := "preview-app1234567-1\npublish-app1234567-1\n"
		ids := parseContainerAppIDs(output)

		if len(ids) != 1 {
			t.Fatalf("expected 1 unique app ID, got %d: %v", len(ids), ids)
		}
		if ids[0] != "app1234567" {
			t.Errorf("expected app1234567, got %q", ids[0])
		}
	})

	t.Run("empty output", func(t *testing.T) {
		ids := parseContainerAppIDs("")
		if len(ids) != 0 {
			t.Fatalf("expected 0 IDs for empty output, got %d", len(ids))
		}
	})

	t.Run("no matching containers", func(t *testing.T) {
		output := "redis-server\nnginx-proxy\nairo-app-mysql\n"
		ids := parseContainerAppIDs(output)

		if len(ids) != 0 {
			t.Fatalf("expected 0 IDs, got %d: %v", len(ids), ids)
		}
	})

	t.Run("trailing newlines", func(t *testing.T) {
		output := "preview-abc123defg-1\npublish-xyz987lmno-1\n\n\n"
		ids := parseContainerAppIDs(output)

		if len(ids) != 2 {
			t.Fatalf("expected 2 IDs, got %d: %v", len(ids), ids)
		}
	})

	t.Run("rejects invalid ids", func(t *testing.T) {
		output := "preview-abc-1\npreview--1\npreview-ABC123DEFG-1\npreview-abc123defg-1\n"
		ids := parseContainerAppIDs(output)

		if len(ids) != 1 {
			t.Fatalf("expected 1 valid ID, got %d: %v", len(ids), ids)
		}
		if ids[0] != "abc123defg" {
			t.Errorf("expected abc123defg, got %q", ids[0])
		}
	})
}

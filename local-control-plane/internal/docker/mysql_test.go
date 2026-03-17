package docker

import (
	"testing"
)

func TestSanitizeForMySQL(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"lowercase kept", "abcxyz", "abcxyz"},
		{"digits kept", "012789", "012789"},
		{"mixed kept", "abc123", "abc123"},
		{"uppercase stripped", "AbCdEf", "bdf"},
		{"special chars stripped", "app-id_123!@#", "appid123"},
		{"empty string", "", ""},
		{"all stripped", "ABC!@#", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizeForMySQL(tt.input)
			if got != tt.expected {
				t.Errorf("sanitizeForMySQL(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestGenerateUsername(t *testing.T) {
	t.Run("prefix and sanitization", func(t *testing.T) {
		username := generateUsername("abc123")
		expected := "user_airo_abc123"
		if username != expected {
			t.Errorf("generateUsername(%q) = %q, want %q", "abc123", username, expected)
		}
	})

	t.Run("truncation at 32 chars", func(t *testing.T) {
		longID := "abcdefghijklmnopqrstuvwxyz123456"
		username := generateUsername(longID)
		if len(username) > 32 {
			t.Errorf("expected username <= 32 chars, got %d: %q", len(username), username)
		}
	})

	t.Run("uppercase stripped from input", func(t *testing.T) {
		username := generateUsername("ABCdef")
		expected := "user_airo_def"
		if username != expected {
			t.Errorf("generateUsername(%q) = %q, want %q", "ABCdef", username, expected)
		}
	})
}

func TestGeneratePassword(t *testing.T) {
	t.Run("length and format", func(t *testing.T) {
		pass, err := generatePassword()
		if err != nil {
			t.Fatalf("generatePassword: %v", err)
		}
		if len(pass) != 32 {
			t.Errorf("expected 32-char hex password, got %d chars", len(pass))
		}
		for _, c := range pass {
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
				t.Errorf("unexpected character %q in hex password", c)
			}
		}
	})

	t.Run("uniqueness", func(t *testing.T) {
		p1, _ := generatePassword()
		p2, _ := generatePassword()
		if p1 == p2 {
			t.Error("expected unique passwords")
		}
	})
}

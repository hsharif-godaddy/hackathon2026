package main

import "strings"

const commandLogPreviewLength = 120

var commandWhitespaceReplacer = strings.NewReplacer("\n", " ", "\r", " ", "\t", " ")

func commandLogPreview(command string) string {
	if command == "" {
		return ""
	}

	normalized := commandWhitespaceReplacer.Replace(strings.TrimSpace(command))
	normalized = strings.Join(strings.Fields(normalized), " ")

	runes := []rune(normalized)
	if len(runes) <= commandLogPreviewLength {
		return normalized
	}

	return string(runes[:commandLogPreviewLength]) + "…"
}

// truncate returns s truncated to maxLen runes with an ellipsis suffix.
// Rune-safe so multi-byte UTF-8 characters aren't bisected.
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "..."
}

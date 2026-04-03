package pipeline

import (
	"strings"
	"testing"
)

func TestMrkdwnToMarkdownBold(t *testing.T) {
	got := MrkdwnToMarkdown("*hello world*")
	if got != "**hello world**" {
		t.Errorf("bold: got %q, want %q", got, "**hello world**")
	}
}

func TestMrkdwnToMarkdownLinks(t *testing.T) {
	got := MrkdwnToMarkdown("<https://github.com/org/repo|View PR>")
	want := "[View PR](https://github.com/org/repo)"
	if got != want {
		t.Errorf("link: got %q, want %q", got, want)
	}
}

func TestMrkdwnToMarkdownBoldInsideLink(t *testing.T) {
	input := "<https://example.com|*Bold Label*>"
	got := MrkdwnToMarkdown(input)
	if !strings.Contains(got, "[**Bold Label**](https://example.com)") {
		t.Errorf("bold-in-link: got %q", got)
	}
}

func TestMrkdwnToMarkdownEmoji(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{":white_check_mark: Deploy", "\u2705 Deploy"},
		{":x: Failed", "\u274C Failed"},
		{":rocket: Launching", "\U0001F680 Launching"},
		{":no_entry: Blocked", "\u26D4 Blocked"},
		{":spinner_: Loading", " Loading"},
	}

	for _, tt := range tests {
		got := MrkdwnToMarkdown(tt.input)
		if got != tt.want {
			t.Errorf("emoji %q: got %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestMrkdwnToMarkdownCombined(t *testing.T) {
	input := ":white_check_mark: *Deploy App* — <https://github.com/org/repo/actions/runs/123|View Run>"
	got := MrkdwnToMarkdown(input)

	if !strings.Contains(got, "\u2705") {
		t.Error("missing check mark emoji")
	}
	if !strings.Contains(got, "**Deploy App**") {
		t.Error("missing bold conversion")
	}
	if !strings.Contains(got, "[View Run](https://github.com/org/repo/actions/runs/123)") {
		t.Error("missing link conversion")
	}
}

func TestMrkdwnToMarkdownPlainText(t *testing.T) {
	input := "no formatting here"
	got := MrkdwnToMarkdown(input)
	if got != input {
		t.Errorf("plain text: got %q, want %q", got, input)
	}
}

package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestConfirmBreakGlass(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"y\n", true},
		{"Y\n", true},
		{"yes\n", true},
		{"  YES  \n", true},
		{"n\n", false},
		{"no\n", false},
		{"nope\n", false},
		{"\n", false}, // bare Enter defaults to no
		{"", false},   // EOF / no input defaults to no
	}
	for _, tc := range cases {
		var out bytes.Buffer
		got := confirmBreakGlass(strings.NewReader(tc.in), &out)
		if got != tc.want {
			t.Errorf("confirmBreakGlass(%q) = %v, want %v", tc.in, got, tc.want)
		}
		// The notice must always point at the GitHub Actions workflow.
		if !strings.Contains(out.String(), releaseWorkflowURL) {
			t.Errorf("notice for input %q omitted the workflow URL:\n%s", tc.in, out.String())
		}
	}
}

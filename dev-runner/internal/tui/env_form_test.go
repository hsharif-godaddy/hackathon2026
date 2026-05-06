package tui

import (
	"testing"

	"charm.land/huh/v2"
)

func TestBuildSelectOptions(t *testing.T) {
	tests := []struct {
		name    string
		options []string
		labels  []string
		want    []huh.Option[string]
	}{
		{
			name:    "nil labels falls back to option values",
			options: []string{"s2s", "api-key"},
			labels:  nil,
			want: []huh.Option[string]{
				huh.NewOption("s2s", "s2s"),
				huh.NewOption("api-key", "api-key"),
			},
		},
		{
			name:    "labels shorter than options: tail falls back to option values",
			options: []string{"s2s", "api-key", "legacy"},
			labels:  []string{"s2s (recommended)"},
			want: []huh.Option[string]{
				huh.NewOption("s2s (recommended)", "s2s"),
				huh.NewOption("api-key", "api-key"),
				huh.NewOption("legacy", "legacy"),
			},
		},
		{
			name:    "empty-string label entry falls back to option value",
			options: []string{"s2s", "api-key"},
			labels:  []string{"", "api-key (deprecated)"},
			want: []huh.Option[string]{
				huh.NewOption("s2s", "s2s"),
				huh.NewOption("api-key (deprecated)", "api-key"),
			},
		},
		{
			name:    "all labels set overrides every option value",
			options: []string{"s2s", "api-key"},
			labels:  []string{"S2S (JWT)", "API Key (deprecated)"},
			want: []huh.Option[string]{
				huh.NewOption("S2S (JWT)", "s2s"),
				huh.NewOption("API Key (deprecated)", "api-key"),
			},
		},
		{
			name:    "empty options yields empty result",
			options: []string{},
			labels:  []string{"ignored"},
			want:    []huh.Option[string]{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := buildSelectOptions(tc.options, tc.labels)
			if len(got) != len(tc.want) {
				t.Fatalf("len = %d, want %d", len(got), len(tc.want))
			}
			for i := range got {
				if got[i].Key != tc.want[i].Key {
					t.Errorf("opts[%d].Key = %q, want %q", i, got[i].Key, tc.want[i].Key)
				}
				if got[i].Value != tc.want[i].Value {
					t.Errorf("opts[%d].Value = %q, want %q", i, got[i].Value, tc.want[i].Value)
				}
			}
		})
	}
}

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeAppsFile(t *testing.T, content string) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "apps-*.txt")
	if err != nil {
		t.Fatalf("create temp file: %v", err)
	}
	if _, err := f.WriteString(content); err != nil {
		t.Fatalf("write temp file: %v", err)
	}
	f.Close()
	return f.Name()
}

func TestReadAppIDs(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []string
	}{
		{
			name:    "basic list",
			content: "app1\napp2\napp3\n",
			want:    []string{"app1", "app2", "app3"},
		},
		{
			name:    "skips blank lines",
			content: "app1\n\napp2\n\n",
			want:    []string{"app1", "app2"},
		},
		{
			name:    "skips comment lines",
			content: "# cohort batch 1\napp1\n# another comment\napp2\n",
			want:    []string{"app1", "app2"},
		},
		{
			name:    "deduplicates repeated appIds",
			content: "app1\napp2\napp1\napp3\napp2\n",
			want:    []string{"app1", "app2", "app3"},
		},
		{
			name:    "trims whitespace",
			content: "  app1  \n  app2\n",
			want:    []string{"app1", "app2"},
		},
		{
			name:    "empty file returns empty slice",
			content: "",
			want:    nil,
		},
		{
			name:    "only comments and blanks returns empty slice",
			content: "# just a comment\n\n# another\n",
			want:    nil,
		},
		{
			name:    "mixed: comments, blanks, dupes, real entries",
			content: "# batch\napp1\n\napp2\n# skip me\napp1\napp3\n",
			want:    []string{"app1", "app2", "app3"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			path := writeAppsFile(t, tc.content)
			got, err := readAppIDs(path)
			if err != nil {
				t.Fatalf("readAppIDs: unexpected error: %v", err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("len: want %d, got %d (%v)", len(tc.want), len(got), got)
			}
			for i, id := range tc.want {
				if got[i] != id {
					t.Errorf("[%d]: want %q, got %q", i, id, got[i])
				}
			}
		})
	}
}

func TestReadAppIDs_ErrorOnMissingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "does-not-exist.txt")
	_, err := readAppIDs(path)
	if err == nil {
		t.Fatal("want error for missing file, got nil")
	}
}

func TestReadAppIDs_Stdin(t *testing.T) {
	content := "app1\n# comment\napp2\n"
	f, err := os.CreateTemp(t.TempDir(), "stdin-*.txt")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	if _, err := f.WriteString(content); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := f.Seek(0, 0); err != nil {
		t.Fatalf("seek: %v", err)
	}
	old := os.Stdin
	os.Stdin = f
	t.Cleanup(func() { os.Stdin = old; f.Close() })

	got, err := readAppIDs("-")
	if err != nil {
		t.Fatalf("readAppIDs('-'): %v", err)
	}
	want := []string{"app1", "app2"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("want %v, got %v", want, got)
	}
}

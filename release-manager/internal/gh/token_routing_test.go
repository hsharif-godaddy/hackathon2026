package gh

import (
	"slices"
	"testing"
)

func TestRepoTokenRouter(t *testing.T) {
	const pioneerTok = "pioneer-xyz"
	const defaultTok = "default-abc"

	tests := []struct {
		name        string
		ownerTokens map[string]string
		repo        string
		want        string
	}{
		{
			name:        "pioneer owner routes to pioneer token",
			ownerTokens: map[string]string{"gdcorp-commerce": pioneerTok},
			repo:        "gdcorp-commerce/pioneer-infra",
			want:        pioneerTok,
		},
		{
			name:        "non-mapped owner falls back to ambient (empty)",
			ownerTokens: map[string]string{"gdcorp-commerce": pioneerTok},
			repo:        "gdcorp-partners/airo-app-builder",
			want:        "",
		},
		{
			name:        "explicit default for partners owner",
			ownerTokens: map[string]string{"gdcorp-commerce": pioneerTok, "gdcorp-partners": defaultTok},
			repo:        "gdcorp-partners/airo-app-builder",
			want:        defaultTok,
		},
		{
			name:        "owner mapped to empty string resolves to ambient",
			ownerTokens: map[string]string{"gdcorp-commerce": ""},
			repo:        "gdcorp-commerce/pioneer-infra",
			want:        "",
		},
		{
			name:        "repo with no slash uses whole string as owner",
			ownerTokens: map[string]string{"weird": "t"},
			repo:        "weird",
			want:        "t",
		},
		{
			name:        "empty map always ambient",
			ownerTokens: map[string]string{},
			repo:        "gdcorp-commerce/pioneer-infra",
			want:        "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := RepoTokenRouter(tt.ownerTokens)(tt.repo)
			if got != tt.want {
				t.Errorf("RepoTokenRouter(%v)(%q) = %q, want %q", tt.ownerTokens, tt.repo, got, tt.want)
			}
		})
	}
}

// TestLiveRunnerTokenFor verifies the nil-safe default: a zero-value LiveRunner
// (as the TUI constructs it) resolves every repo to "" (ambient auth),
// preserving the pre-existing behavior.
func TestLiveRunnerTokenFor(t *testing.T) {
	var zero LiveRunner
	if got := zero.tokenFor("gdcorp-commerce/pioneer-infra"); got != "" {
		t.Errorf("zero-value LiveRunner.tokenFor = %q, want \"\" (ambient)", got)
	}

	routed := LiveRunner{TokenForRepo: RepoTokenRouter(map[string]string{"gdcorp-commerce": "pio"})}
	if got := routed.tokenFor("gdcorp-commerce/pioneer-infra"); got != "pio" {
		t.Errorf("routed LiveRunner.tokenFor(pioneer) = %q, want \"pio\"", got)
	}
	if got := routed.tokenFor("gdcorp-partners/airo-app-builder"); got != "" {
		t.Errorf("routed LiveRunner.tokenFor(partners) = %q, want \"\" (ambient)", got)
	}
}

func TestCommandEnv(t *testing.T) {
	base := []string{"PATH=/usr/bin", "HOME=/home/x"}

	t.Run("empty token leaves env untouched", func(t *testing.T) {
		got := commandEnv(base, "")
		if !slices.Equal(got, base) {
			t.Errorf("commandEnv(base, \"\") = %v, want unchanged %v", got, base)
		}
	})

	t.Run("token appends GH_TOKEN without mutating base", func(t *testing.T) {
		got := commandEnv(base, "tok123")
		want := []string{"PATH=/usr/bin", "HOME=/home/x", "GH_TOKEN=tok123"}
		if !slices.Equal(got, want) {
			t.Errorf("commandEnv = %v, want %v", got, want)
		}
		// base must not be mutated (append-to-copy, not append-in-place).
		if len(base) != 2 {
			t.Errorf("commandEnv mutated base: len=%d, want 2", len(base))
		}
	})

	t.Run("later GH_TOKEN overrides an ambient one", func(t *testing.T) {
		amb := []string{"GH_TOKEN=ambient", "PATH=/usr/bin"}
		got := commandEnv(amb, "override")
		// exec uses the last matching entry, so the appended override wins.
		if got[len(got)-1] != "GH_TOKEN=override" {
			t.Errorf("last env entry = %q, want GH_TOKEN=override", got[len(got)-1])
		}
	})
}

package fixers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRewriteNarrowNpmEntries(t *testing.T) {
	const broad = "//gdartifactory1.jfrog.io/artifactory/api/npm/"
	cases := map[string]struct {
		in      string
		want    string
		changed bool
	}{
		"broadens node-virt": {
			in:      "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=abc\n",
			want:    broad + ":_authToken=abc\n",
			changed: true,
		},
		"already broad, no change": {
			in:      broad + ":_authToken=abc\n",
			want:    broad + ":_authToken=abc\n",
			changed: false,
		},
		"ignores commented narrow line": {
			in:      "# //gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=stale\n",
			want:    "# //gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=stale\n",
			changed: false,
		},
		"preserves surrounding lines": {
			in: "registry=https://registry.npmjs.org/\n" +
				"//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=abc\n" +
				"always-auth=true\n",
			want: "registry=https://registry.npmjs.org/\n" +
				broad + ":_authToken=abc\n" +
				"always-auth=true\n",
			changed: true,
		},
		"non-jfrog lines untouched": {
			in:      "//other.registry/:_authToken=xyz\n",
			want:    "//other.registry/:_authToken=xyz\n",
			changed: false,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, changed := rewriteNarrowNpmEntries(tc.in)
			if got != tc.want {
				t.Errorf("content mismatch\ngot:  %q\nwant: %q", got, tc.want)
			}
			if changed != tc.changed {
				t.Errorf("changed=%v, want %v", changed, tc.changed)
			}
		})
	}
}

func TestBroadenNpmrcScope_RewritesFile(t *testing.T) {
	tmpHome := t.TempDir()
	npmrc := filepath.Join(tmpHome, ".npmrc")
	content := "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=abc\n"
	if err := os.WriteFile(npmrc, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", tmpHome)

	changed, err := broadenNpmrcScope()
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected file to be rewritten")
	}
	got, err := os.ReadFile(npmrc)
	if err != nil {
		t.Fatal(err)
	}
	want := "//gdartifactory1.jfrog.io/artifactory/api/npm/:_authToken=abc"
	if !strings.Contains(string(got), want) {
		t.Errorf("expected file to contain %q, got: %s", want, got)
	}
	if strings.Contains(string(got), "node-virt") {
		t.Errorf("expected narrow node-virt prefix to be gone, got: %s", got)
	}
}

func TestBroadenNpmrcScope_NoFileNoChange(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	changed, err := broadenNpmrcScope()
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Error("expected no change when ~/.npmrc is absent")
	}
}

func TestBroadenNpmrcScope_AlreadyBroad(t *testing.T) {
	tmpHome := t.TempDir()
	npmrc := filepath.Join(tmpHome, ".npmrc")
	content := "//gdartifactory1.jfrog.io/artifactory/api/npm/:_authToken=abc\n"
	if err := os.WriteFile(npmrc, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", tmpHome)

	changed, err := broadenNpmrcScope()
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Error("expected no change when token is already at the broad prefix")
	}
}

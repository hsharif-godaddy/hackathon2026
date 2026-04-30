package fixers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestE2EFixer_FormFields_SkipsWhenCredsAlreadyPresent(t *testing.T) {
	// The skip-form path is the primary value-add of FormFields() over
	// always-prompting; without a test, the "re-run doesn't re-prompt"
	// contract drifts unnoticed.
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tests"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(dir, "tests", ".env"),
		[]byte("E2E_USERNAME='alice@example.com'\nE2E_PASSWORD='hunter2'\n"),
		0600,
	); err != nil {
		t.Fatal(err)
	}

	f := &E2EFixer{ProjectRoot: dir}
	if got := f.FormFields(); got != nil {
		t.Errorf("FormFields() = %v, want nil (creds already on disk)", got)
	}
}

func TestE2EFixer_FormFields_PromptsWhenCredsMissing(t *testing.T) {
	dir := t.TempDir()
	f := &E2EFixer{ProjectRoot: dir}

	got := f.FormFields()
	if len(got) != 2 {
		t.Fatalf("FormFields() returned %d fields, want 2", len(got))
	}
	if got[0].Key != "username" || got[1].Key != "password" {
		t.Errorf("expected username + password fields, got %v / %v", got[0].Key, got[1].Key)
	}
	if !got[0].Required || !got[1].Required {
		t.Errorf("both fields should be Required; got username.Required=%v password.Required=%v", got[0].Required, got[1].Required)
	}
	if !got[1].Password {
		t.Errorf("password field should have Password=true")
	}
}

func TestE2EFixer_FormFields_SurfacesUnreadableEnvFile(t *testing.T) {
	// On systems where chmod is honored (POSIX), an unreadable tests/.env
	// should still produce a form, but the description should mention the
	// read error so the user understands why the form re-appeared.
	if os.Getuid() == 0 {
		t.Skip("running as root; chmod 0000 doesn't restrict reads")
	}
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tests"), 0755); err != nil {
		t.Fatal(err)
	}
	envPath := filepath.Join(dir, "tests", ".env")
	if err := os.WriteFile(envPath, []byte("E2E_USERNAME=u\nE2E_PASSWORD=p\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(envPath, 0000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(envPath, 0600) })

	f := &E2EFixer{ProjectRoot: dir}
	got := f.FormFields()
	if len(got) != 2 {
		t.Fatalf("FormFields() returned %d fields, want 2", len(got))
	}
	if !strings.Contains(got[0].Description, "Could not read existing tests/.env") {
		t.Errorf("description should mention the read error, got: %q", got[0].Description)
	}
}

func TestE2EFixer_writeCredentials_NewFile(t *testing.T) {
	dir := t.TempDir()
	f := &E2EFixer{
		ProjectRoot: dir,
		username:    "alice@example.com",
		password:    "hunter2",
	}

	if err := f.writeCredentials(dir); err != nil {
		t.Fatalf("writeCredentials: %v", err)
	}

	envPath := filepath.Join(dir, "tests", ".env")
	info, err := os.Stat(envPath)
	if err != nil {
		t.Fatalf("stat tests/.env: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Errorf("permissions = %o, want 0600", perm)
	}

	contents, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	got := string(contents)
	if !strings.Contains(got, "E2E_USERNAME='alice@example.com'") {
		t.Errorf("missing username line: %q", got)
	}
	if !strings.Contains(got, "E2E_PASSWORD='hunter2'") {
		t.Errorf("missing password line: %q", got)
	}
}

func TestE2EFixer_writeCredentials_PreservesExisting(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tests"), 0755); err != nil {
		t.Fatal(err)
	}
	envPath := filepath.Join(dir, "tests", ".env")
	existing := "TEST_USERNAME='legacy'\nTEST_PASSWORD='legacypw'\n"
	if err := os.WriteFile(envPath, []byte(existing), 0600); err != nil {
		t.Fatal(err)
	}

	f := &E2EFixer{ProjectRoot: dir, username: "new", password: "newpw"}
	if err := f.writeCredentials(dir); err != nil {
		t.Fatal(err)
	}

	contents, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	got := string(contents)
	for _, want := range []string{
		"TEST_USERNAME='legacy'",
		"TEST_PASSWORD='legacypw'",
		"E2E_USERNAME='new'",
		"E2E_PASSWORD='newpw'",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in result:\n%s", want, got)
		}
	}
	// Each managed key should appear exactly once. Contains() alone misses
	// duplicates, but duplicates make effective credentials unpredictable.
	if n := strings.Count(got, "E2E_USERNAME="); n != 1 {
		t.Errorf("E2E_USERNAME= appears %d times, want 1\n%s", n, got)
	}
	if n := strings.Count(got, "E2E_PASSWORD="); n != 1 {
		t.Errorf("E2E_PASSWORD= appears %d times, want 1\n%s", n, got)
	}

	// Backup should exist with the original content (file pre-existed).
	backup, err := os.ReadFile(envPath + ".bak")
	if err != nil {
		t.Fatalf("backup not written: %v", err)
	}
	if string(backup) != existing {
		t.Errorf("backup mismatch: got %q, want %q", string(backup), existing)
	}
}

func TestE2EFixer_writeCredentials_RejectsSingleQuote(t *testing.T) {
	dir := t.TempDir()

	for _, tt := range []struct{ name, user, pass string }{
		{"username has quote", "alice'admin", "pw"},
		{"password has quote", "alice", "hunter'2"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f := &E2EFixer{ProjectRoot: dir, username: tt.user, password: tt.pass}
			err := f.writeCredentials(dir)
			if err == nil {
				t.Fatal("writeCredentials accepted credentials with single quote")
			}
			if !strings.Contains(err.Error(), "single quote") {
				t.Errorf("error message should mention single quote, got: %v", err)
			}
		})
	}
}

func TestE2EFixer_writeCredentials_AppendsTrailingNewline(t *testing.T) {
	// An existing file without a trailing newline must get one before our
	// append, otherwise the first appended line concatenates onto the last
	// existing one. Mirrors the precaution in scripts/setup-e2e.sh:141-143.
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tests"), 0755); err != nil {
		t.Fatal(err)
	}
	envPath := filepath.Join(dir, "tests", ".env")
	if err := os.WriteFile(envPath, []byte("FOO=bar"), 0600); err != nil {
		t.Fatal(err)
	}

	f := &E2EFixer{ProjectRoot: dir, username: "u", password: "p"}
	if err := f.writeCredentials(dir); err != nil {
		t.Fatal(err)
	}

	contents, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	got := string(contents)
	if strings.Contains(got, "barE2E_USERNAME") {
		t.Errorf("lines concatenated without separator:\n%s", got)
	}
	if !strings.Contains(got, "FOO=bar\nE2E_USERNAME='u'") {
		t.Errorf("expected FOO=bar then E2E_USERNAME on next line:\n%s", got)
	}
}

func TestE2EFixer_writeCredentials_NoDuplicateKeysOnRerun(t *testing.T) {
	// A second writeCredentials call (e.g., re-running the fixer with new
	// values) must replace the previous E2E_USERNAME/E2E_PASSWORD assignments,
	// not append duplicates. dotenv parsers vary on which value wins when
	// duplicate keys are present, so duplicates make effective creds
	// unpredictable.
	dir := t.TempDir()

	first := &E2EFixer{ProjectRoot: dir, username: "alice", password: "pw1"}
	if err := first.writeCredentials(dir); err != nil {
		t.Fatalf("first write: %v", err)
	}

	second := &E2EFixer{ProjectRoot: dir, username: "bob", password: "pw2"}
	if err := second.writeCredentials(dir); err != nil {
		t.Fatalf("second write: %v", err)
	}

	contents, err := os.ReadFile(filepath.Join(dir, "tests", ".env"))
	if err != nil {
		t.Fatal(err)
	}
	got := string(contents)

	if n := strings.Count(got, "E2E_USERNAME="); n != 1 {
		t.Errorf("E2E_USERNAME= appears %d times, want 1\n%s", n, got)
	}
	if n := strings.Count(got, "E2E_PASSWORD="); n != 1 {
		t.Errorf("E2E_PASSWORD= appears %d times, want 1\n%s", n, got)
	}
	if !strings.Contains(got, "E2E_USERNAME='bob'") {
		t.Errorf("expected new username 'bob' to win, got:\n%s", got)
	}
	if strings.Contains(got, "E2E_USERNAME='alice'") {
		t.Errorf("expected old username 'alice' stripped, got:\n%s", got)
	}
}

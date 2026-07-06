//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/landlock-lsm/go-landlock/landlock"
	llsyscall "github.com/landlock-lsm/go-landlock/landlock/syscall"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
)

func TestModeToAccessFS_Read(t *testing.T) {
	t.Parallel()
	access := modeToAccessFS("r")
	want := llsyscall.AccessFSReadFile | llsyscall.AccessFSReadDir
	if access != landlock.AccessFSSet(want) {
		t.Errorf("modeToAccessFS(\"r\") = %v, want ReadFile|ReadDir (%v)", access, want)
	}
}

func TestModeToAccessFS_Write(t *testing.T) {
	t.Parallel()
	access := modeToAccessFS("w")
	want := llsyscall.AccessFSWriteFile | llsyscall.AccessFSTruncate
	if access != landlock.AccessFSSet(want) {
		t.Errorf("modeToAccessFS(\"w\") = %v, want WriteFile|Truncate (%v)", access, want)
	}
}

func TestModeToAccessFS_Execute(t *testing.T) {
	t.Parallel()
	access := modeToAccessFS("x")
	want := llsyscall.AccessFSExecute
	if access != landlock.AccessFSSet(want) {
		t.Errorf("modeToAccessFS(\"x\") = %v, want Execute (%v)", access, want)
	}
}

func TestModeToAccessFS_Create(t *testing.T) {
	t.Parallel()
	access := modeToAccessFS("c")

	// c should include all make/remove/refer/ioctl-dev flags
	wantFlags := []landlock.AccessFSSet{
		landlock.AccessFSSet(llsyscall.AccessFSMakeReg),
		landlock.AccessFSSet(llsyscall.AccessFSMakeDir),
		landlock.AccessFSSet(llsyscall.AccessFSMakeSock),
		landlock.AccessFSSet(llsyscall.AccessFSMakeFifo),
		landlock.AccessFSSet(llsyscall.AccessFSMakeBlock),
		landlock.AccessFSSet(llsyscall.AccessFSMakeSym),
		landlock.AccessFSSet(llsyscall.AccessFSMakeChar),
		landlock.AccessFSSet(llsyscall.AccessFSRemoveFile),
		landlock.AccessFSSet(llsyscall.AccessFSRemoveDir),
		landlock.AccessFSSet(llsyscall.AccessFSRefer),
		landlock.AccessFSSet(llsyscall.AccessFSIoctlDev),
	}
	for _, flag := range wantFlags {
		if access&flag == 0 {
			t.Errorf("modeToAccessFS(\"c\") missing flag %v", flag)
		}
	}
}

func TestModeToAccessFS_Combined(t *testing.T) {
	t.Parallel()
	access := modeToAccessFS("rwx")
	// Should include read, write, and execute flags
	if access&landlock.AccessFSSet(llsyscall.AccessFSReadFile) == 0 {
		t.Error("rwx missing ReadFile")
	}
	if access&landlock.AccessFSSet(llsyscall.AccessFSWriteFile) == 0 {
		t.Error("rwx missing WriteFile")
	}
	if access&landlock.AccessFSSet(llsyscall.AccessFSExecute) == 0 {
		t.Error("rwx missing Execute")
	}
}

func TestModeToAccessFS_InvalidChar(t *testing.T) {
	t.Parallel()
	// Unknown chars are silently ignored (validation happens earlier in config)
	access := modeToAccessFS("z")
	if access != 0 {
		t.Errorf("modeToAccessFS(\"z\") = %v, want 0", access)
	}
}

func TestFileAccessOnly(t *testing.T) {
	t.Parallel()
	// Start with all directory+file flags from "rwc" mode
	dirAccess := modeToAccessFS("rwc")
	fileAccess := fileAccessOnly(dirAccess)

	// Should keep file-valid flags
	if fileAccess&landlock.AccessFSSet(llsyscall.AccessFSReadFile) == 0 {
		t.Error("fileAccessOnly stripped ReadFile")
	}
	if fileAccess&landlock.AccessFSSet(llsyscall.AccessFSWriteFile) == 0 {
		t.Error("fileAccessOnly stripped WriteFile")
	}
	if fileAccess&landlock.AccessFSSet(llsyscall.AccessFSTruncate) == 0 {
		t.Error("fileAccessOnly stripped Truncate")
	}

	// Should strip directory-only flags
	if fileAccess&landlock.AccessFSSet(llsyscall.AccessFSReadDir) != 0 {
		t.Error("fileAccessOnly kept ReadDir")
	}
	if fileAccess&landlock.AccessFSSet(llsyscall.AccessFSMakeReg) != 0 {
		t.Error("fileAccessOnly kept MakeReg")
	}
	if fileAccess&landlock.AccessFSSet(llsyscall.AccessFSRemoveFile) != 0 {
		t.Error("fileAccessOnly kept RemoveFile")
	}
}

func TestFileAccessOnly_ExecutePreserved(t *testing.T) {
	t.Parallel()
	access := modeToAccessFS("rx")
	fileAccess := fileAccessOnly(access)
	if fileAccess&landlock.AccessFSSet(llsyscall.AccessFSExecute) == 0 {
		t.Error("fileAccessOnly stripped Execute from file")
	}
}

func TestBuildLandlockRules_AppliesDefaults(t *testing.T) {
	t.Parallel()
	cfg := &SandboxConfig{
		Command: "echo hello",
		WorkDir: "/tmp",
	}
	rules := buildLandlockRules(cfg)
	// Defaults are always applied; at least some paths exist on any Linux host.
	if len(rules) == 0 {
		t.Error("buildLandlockRules produced no default rules")
	}
}

func TestBuildLandlockRules_UserPaths(t *testing.T) {
	t.Parallel()

	// Create a real temp dir so the path exists
	dir := t.TempDir()

	cfg := &SandboxConfig{
		Paths: []sandbox.PathRule{
			{Mode: "rwc", Path: dir},
		},
		Command: "echo hello",
		WorkDir: "/tmp",
	}
	rules := buildLandlockRules(cfg)
	// Defaults + 1 user path. Can't assert exact count (defaults vary by distro),
	// just that the user path added to the default baseline.
	baseline := len(buildLandlockRules(&SandboxConfig{Command: "x", WorkDir: "/tmp"}))
	if len(rules) != baseline+1 {
		t.Errorf("expected %d rules (baseline + user path), got %d", baseline+1, len(rules))
	}
}

func TestBuildLandlockRules_SkipsMissingUserPaths(t *testing.T) {
	t.Parallel()
	cfg := &SandboxConfig{
		Paths: []sandbox.PathRule{
			{Mode: "r", Path: "/nonexistent/path/that/does/not/exist"},
		},
		Command: "echo hello",
		WorkDir: "/tmp",
	}
	rules := buildLandlockRules(cfg)
	baseline := len(buildLandlockRules(&SandboxConfig{Command: "x", WorkDir: "/tmp"}))
	if len(rules) != baseline {
		t.Errorf("missing user path should not add rules: got %d, baseline %d", len(rules), baseline)
	}
}

func TestBuildLandlockRules_NetworkPorts(t *testing.T) {
	t.Parallel()
	cfg := &SandboxConfig{
		ConnectTCP: []uint16{80, 443},
		BindTCP:    []uint16{3000},
		Command:    "echo hello",
		WorkDir:    "/tmp",
	}
	rules := buildLandlockRules(cfg)
	baseline := len(buildLandlockRules(&SandboxConfig{Command: "x", WorkDir: "/tmp"}))
	// 2 connect + 1 bind on top of defaults.
	if len(rules) != baseline+3 {
		t.Errorf("expected %d rules (baseline + 3 network), got %d", baseline+3, len(rules))
	}
}

func TestPathToRule_Directory(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	rule, ok := pathToRule(sandbox.PathRule{Mode: "rwc", Path: dir})
	if !ok {
		t.Fatal("pathToRule returned false for existing directory")
	}
	if rule == nil {
		t.Fatal("pathToRule returned nil rule for existing directory")
	}
}

func TestPathToRule_File(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	file := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(file, []byte("test"), 0o644); err != nil {
		t.Fatal(err)
	}
	rule, ok := pathToRule(sandbox.PathRule{Mode: "rw", Path: file})
	if !ok {
		t.Fatal("pathToRule returned false for existing file")
	}
	if rule == nil {
		t.Fatal("pathToRule returned nil rule for existing file")
	}
}

func TestPathToRule_Nonexistent(t *testing.T) {
	t.Parallel()
	_, ok := pathToRule(sandbox.PathRule{Mode: "r", Path: "/nonexistent/path"})
	if ok {
		t.Error("pathToRule returned true for nonexistent path")
	}
}

func TestModeToAccessFS_RWCXCoversAllV6HandledBits(t *testing.T) {
	t.Parallel()
	// go-landlock V6 handledAccessFS = (1 << 16) - 1 (all 16 FS bits).
	// If a library upgrade adds new handled bits, this test fails — signaling
	// that modeToAccessFS needs updating to avoid silent REFER breakage.
	const v6HandledAccessFS landlock.AccessFSSet = (1 << 16) - 1
	access := modeToAccessFS("rwcx")
	if access != v6HandledAccessFS {
		t.Errorf("modeToAccessFS(\"rwcx\") = 0x%x, want 0x%x (all V6 handled FS bits)\n"+
			"missing bits: 0x%x", access, v6HandledAccessFS, v6HandledAccessFS&^access)
	}
}

// TestV6ConfigStillCarriesScoping verifies that landlock.V6's config includes
// IPC scoping bits, confirming that V6.Restrict() alone enforces scoping — no
// separate RestrictScoped() call is needed.
//
// This is a library-assumption tripwire, not a behavioral test. The actual
// behavioral guard (cross-directory rename succeeds under sandbox) is validated
// by make test-linux and the production deploy verification. This test catches
// the case where a go-landlock upgrade removes scoping from the V6 preset.
//
// Background: a separate RestrictScoped() creates a second Landlock layer with
// handled_access_fs=0. The kernel's LANDLOCK_ACCESS_FS_INITIALLY_DENIED causes
// every layer to implicitly handle REFER. A layer with no FS path rules can
// never satisfy REFER, making all cross-directory renames return EXDEV.
func TestV6ConfigStillCarriesScoping(t *testing.T) {
	t.Parallel()
	// landlock.V6 fields are unexported; String() is the only introspection.
	// V6 with all scoped bits set renders "Scoped: all"; zero renders "Scoped: ∅".
	const wantFragment = "Scoped: all"
	str := landlock.V6.String()
	if !strings.Contains(str, wantFragment) {
		t.Errorf("landlock.V6.String() = %q, want substring %q\n"+
			"If V6 no longer carries scoping, applySandboxAndExec needs a "+
			"separate RestrictScoped call (but see REFER layer poisoning caveat in "+
			"sandbox_linux.go — a second layer poisons REFER)", str, wantFragment)
	}
}

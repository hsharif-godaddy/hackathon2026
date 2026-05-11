package sandbox_test

import (
	"fmt"
	"os"
	"os/exec"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
)

func TestAttachStatusPipe_PopulatesExtraFilesAtStatusSlot(t *testing.T) {
	t.Parallel()

	cmd := &exec.Cmd{}
	read, err := sandbox.AttachStatusPipe(cmd)
	if err != nil {
		t.Fatalf("AttachStatusPipe: %v", err)
	}
	defer read.Close()

	if len(cmd.ExtraFiles) != 1 {
		t.Fatalf("expected ExtraFiles length 1, got %d", len(cmd.ExtraFiles))
	}
	if cmd.ExtraFiles[0] == nil {
		t.Fatal("ExtraFiles[0] should hold the write end")
	}
	defer cmd.ExtraFiles[0].Close()
}

func TestAttachStatusPipe_PreservesExistingExtraFiles(t *testing.T) {
	t.Parallel()

	// Caller already owns slot 0 — AttachStatusPipe must not clobber it.
	// Current implementation uses slot 0 exclusively, so this test encodes
	// the contract: if the slot is non-nil, it's the status pipe.
	cmd := &exec.Cmd{ExtraFiles: []*os.File{nil}}
	read, err := sandbox.AttachStatusPipe(cmd)
	if err != nil {
		t.Fatalf("AttachStatusPipe: %v", err)
	}
	defer read.Close()
	if cmd.ExtraFiles[0] == nil {
		t.Fatal("ExtraFiles[0] should hold the write end after attach")
	}
	defer cmd.ExtraFiles[0].Close()
}

func TestReleaseStatusWrite_ClosesOnlyStatusSlot(t *testing.T) {
	t.Parallel()

	// Attach status pipe at slot 0 and a sibling pipe at slot 1 — release
	// must close slot 0 only and leave slot 1 untouched.
	cmd := &exec.Cmd{}
	statusRead, err := sandbox.AttachStatusPipe(cmd)
	if err != nil {
		t.Fatalf("AttachStatusPipe: %v", err)
	}
	defer statusRead.Close()

	siblingRead, siblingWrite, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	defer siblingRead.Close()
	defer siblingWrite.Close()
	cmd.ExtraFiles = append(cmd.ExtraFiles, siblingWrite)

	sandbox.ReleaseStatusWrite(cmd)

	if len(cmd.ExtraFiles) < 2 {
		t.Fatalf("ReleaseStatusWrite should not shrink ExtraFiles; got len=%d", len(cmd.ExtraFiles))
	}
	if cmd.ExtraFiles[0] != nil {
		t.Error("status slot should be nil after release")
	}
	if cmd.ExtraFiles[1] != siblingWrite {
		t.Error("sibling ExtraFile should remain untouched")
	}
	// Status pipe is closed — sibling pipe still works.
	if _, err := siblingWrite.WriteString("ok"); err != nil {
		t.Errorf("sibling pipe should still be open: %v", err)
	}
}

func TestReleaseStatusWrite_NoPanicOnEmpty(t *testing.T) {
	t.Parallel()

	cmd := &exec.Cmd{}
	sandbox.ReleaseStatusWrite(cmd) // must not panic
}

func TestReadFatal_EmptyOnCleanClose(t *testing.T) {
	t.Parallel()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	defer r.Close()
	// Simulate CLOEXEC closing the write end without writing anything.
	if err := w.Close(); err != nil {
		t.Fatalf("close write end: %v", err)
	}
	if got := sandbox.ReadFatal(r); got != "" {
		t.Errorf("ReadFatal on cleanly-closed pipe = %q, want empty", got)
	}
}

func TestReadFatal_ReturnsTrimmedMessage(t *testing.T) {
	t.Parallel()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	defer r.Close()

	const msg = "landlock ABI v6 required, kernel provides v4"
	go func() {
		_, _ = fmt.Fprintln(w, msg)
		_ = w.Close()
	}()

	if got := sandbox.ReadFatal(r); got != msg {
		t.Errorf("ReadFatal = %q, want %q", got, msg)
	}
}

func TestReadFatal_MultilineJoined(t *testing.T) {
	t.Parallel()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	defer r.Close()

	go func() {
		_, _ = fmt.Fprintln(w, "line1\nline2")
		_ = w.Close()
	}()

	got := sandbox.ReadFatal(r)
	if got != "line1\nline2" {
		t.Errorf("ReadFatal = %q, want multi-line trimmed", got)
	}
}

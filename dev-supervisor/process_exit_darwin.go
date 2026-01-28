//go:build darwin

package main

import (
	"os/exec"
	"syscall"
)

// isExpectedSignalExit checks if an error from cmd.Wait() is from an expected signal termination.
// Expected signals are those used for graceful shutdown (SIGTERM, SIGINT) or force kill (SIGKILL).
// Crash signals like SIGSEGV, SIGABRT, etc. are NOT considered expected.
//
// On Darwin (macOS), we use syscall.WaitStatus to properly inspect the signal that caused termination.
//
// Returns (expected, exitCode). exitCode is nil if the error doesn't contain an exit code.
func isExpectedSignalExit(err error) (bool, *int) {
	if err == nil {
		code := 0
		return true, &code
	}

	exitError, ok := err.(*exec.ExitError)
	if !ok {
		return false, nil
	}

	// Get the platform-specific wait status
	waitStatus, ok := exitError.Sys().(syscall.WaitStatus)
	if !ok {
		// Fallback: couldn't get wait status, use exit code
		exitCode := exitError.ExitCode()
		isExpected := exitCode == 143 || exitCode == 130 || exitCode == 137
		return isExpected, &exitCode
	}

	// Check if process was terminated by a signal
	if waitStatus.Signaled() {
		signal := waitStatus.Signal()
		exitCode := -1 // Darwin returns -1 for signal exits

		// Expected signals for graceful shutdown:
		// SIGTERM (15) - graceful shutdown
		// SIGINT (2) - Ctrl+C
		// SIGKILL (9) - force kill
		//
		// NOT included: SIGSEGV (11), SIGABRT (6), etc. - these are crashes
		isExpected := signal == syscall.SIGTERM || signal == syscall.SIGINT || signal == syscall.SIGKILL
		return isExpected, &exitCode
	}

	// Process exited normally (not by signal)
	exitCode := waitStatus.ExitStatus()
	return exitCode == 0, &exitCode
}

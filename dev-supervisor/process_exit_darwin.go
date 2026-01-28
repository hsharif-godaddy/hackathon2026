//go:build darwin

package main

import (
	"os/exec"
	"syscall"
)

// isShellSignalExitCode checks if an exit code matches the 128+signal pattern
// used by shell scripts that catch signals and exit with 128+signal.
// This handles shells that don't use 'exec', so they remain as the parent process
// and exit with 128+signal when they catch SIGTERM/SIGINT/SIGKILL.
func isShellSignalExitCode(exitCode int) bool {
	return exitCode == 128+int(syscall.SIGTERM) || // 143 - graceful shutdown
		exitCode == 128+int(syscall.SIGINT) || // 130 - user interrupt (Ctrl+C)
		exitCode == 128+int(syscall.SIGKILL) // 137 - forced shutdown
}

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
		// Check for 128+signal exit codes from shell scripts
		exitCode := exitError.ExitCode()
		isExpected := exitCode == 0 || isShellSignalExitCode(exitCode)
		return isExpected, &exitCode
	}

	// Check if process was terminated by a signal
	if waitStatus.Signaled() {
		signal := waitStatus.Signal()
		// Use 128 + signal convention for consistency with Linux
		exitCode := 128 + int(signal)

		// Expected signals (matching Docker's shutdown pattern):
		// SIGTERM (15) - graceful shutdown
		// SIGINT (2) - user interrupt (Ctrl+C)
		// SIGKILL (9) - forced shutdown (after timeout or explicit force kill)
		//
		// NOT included: SIGHUP (config reload), SIGQUIT (core dump),
		// SIGSEGV/SIGABRT/etc (crashes)
		isExpected := signal == syscall.SIGTERM || signal == syscall.SIGINT || signal == syscall.SIGKILL
		return isExpected, &exitCode
	}

	// Process exited normally (not by signal)
	// However, shell scripts may catch signals and exit with 128+signal as their exit code
	// So we also check for known signal exit codes here
	exitCode := waitStatus.ExitStatus()
	isExpected := exitCode == 0 || isShellSignalExitCode(exitCode)
	return isExpected, &exitCode
}

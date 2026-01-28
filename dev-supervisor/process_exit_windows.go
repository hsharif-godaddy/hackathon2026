//go:build windows

package main

import (
	"os/exec"
)

// Windows-specific exit codes for process termination
// Reference: https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes
const (
	// STATUS_CONTROL_C_EXIT - Process terminated by Ctrl+C or GenerateConsoleCtrlEvent
	// This is the Windows equivalent of SIGINT
	STATUS_CONTROL_C_EXIT = 0xC000013A

	// Exit codes from taskkill and TerminateProcess
	// taskkill typically exits the target process with code 1
	// However, we can't reliably distinguish between taskkill and actual errors
	// so we only treat 0 and STATUS_CONTROL_C_EXIT as expected
)

// isExpectedSignalExit checks if an error from cmd.Wait() is from an expected signal termination.
// On Windows, process termination works differently than Unix signals, but we check for expected exit codes.
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

	exitCode := exitError.ExitCode()

	// Expected Windows exit codes:
	// 0 - Normal termination
	// 0xC000013A (STATUS_CONTROL_C_EXIT) - Ctrl+C / Ctrl+Break termination
	//
	// Note: We cannot reliably detect graceful termination via taskkill or TerminateProcess
	// as they don't have standardized exit codes. Those will be treated as errors unless
	// the application exits with code 0.
	isExpected := exitCode == 0 || exitCode == int(STATUS_CONTROL_C_EXIT)
	return isExpected, &exitCode
}

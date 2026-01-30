package process

// IsExpectedSignalExit checks if an error from cmd.Wait() is from an expected signal termination.
// Expected signals are those used for graceful shutdown (SIGTERM, SIGINT) or force kill (SIGKILL).
// Crash signals like SIGSEGV, SIGABRT, etc. are NOT considered expected.
//
// Returns (expected, exitCode). exitCode is nil if the error doesn't contain an exit code.
//
// Platform-specific implementations handle:
//   - Unix/Linux: syscall.WaitStatus for signal detection
//   - Darwin: syscall.WaitStatus with macOS-specific behavior
//   - Windows: Limited support (only Ctrl+C detection via STATUS_CONTROL_C_EXIT)
//
// Shell script exit codes (128+signal) are also recognized as expected when the
// signal is SIGTERM, SIGINT, or SIGKILL. This handles shells that don't use 'exec'
// and remain as the parent process.

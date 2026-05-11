//go:build docker_integration

package main

import (
	"os/exec"
	"testing"
)

func TestDockerIntegration(t *testing.T) {
	// Check if Docker is available
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("Docker not available, skipping integration tests")
	}

	// Run docker integration tests
	cmd := exec.Command("./test/run-docker-tests.sh")
	output, err := cmd.CombinedOutput()

	t.Logf("Docker integration test output:\n%s", string(output))

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode := exitErr.ExitCode()
			switch exitCode {
			case 1:
				t.Fatalf("Test 1 failed: PID 1 verification")
			case 2:
				t.Fatalf("Test 2 failed: API health check")
			case 3:
				t.Fatalf("Test 3 failed: Process lifecycle")
			case 4:
				t.Fatalf("Test 4 failed: Orphan reaping")
			case 5:
				t.Fatalf("Test 5 failed: Signal handling")
			case 6:
				t.Fatalf("Test 6 failed: Sandbox blocks disallowed paths")
			case 7:
				t.Fatalf("Test 7 failed: Sandbox allows allowed paths")
			case 99:
				t.Fatalf("Test setup failed")
			default:
				t.Fatalf("Tests failed with exit code %d", exitCode)
			}
		}
		t.Fatalf("Failed to run integration tests: %v", err)
	}
}

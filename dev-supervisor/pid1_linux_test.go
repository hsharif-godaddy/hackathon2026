//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/ports"
	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

func TestManagedProcess_PID1ManagedWait(t *testing.T) {
	logMgr := logs.NewManager(100)
	pid1Mgr := process.NewPID1Manager()
	pid1Mgr.SetPID1ForTesting(true)

	pm := NewProcessManager(logMgr, pid1Mgr)

	if err := pm.Start(validation.ProcessStartRequest{Command: "echo 'pid1 test'"}); err != nil {
		t.Fatalf("failed to start process: %v", err)
	}

	time.Sleep(50 * time.Millisecond)

	pm.mu.RLock()
	managedProcess := pm.currentProcess
	pm.mu.RUnlock()

	if managedProcess == nil {
		t.Fatal("expected managed process to be present")
		return
	}

	if !managedProcess.usePID1Wait {
		t.Fatal("expected process to be managed by PID1 path")
	}

	managedProcess.WaitForCompletion()

	status := managedProcess.GetInfo()
	if status.State != ProcessStateStopped {
		t.Fatalf("expected process to stop cleanly, got state %s (error: %s)", status.State, status.Error)
	}

	if count := pid1Mgr.GetChildProcessCount(); count != 0 {
		t.Fatalf("expected PID1 manager to unregister child, found %d remaining", count)
	}
}

func TestPID1OrphanReaping(t *testing.T) {
	// Skip if not running as PID 1 in container
	if os.Getpid() != 1 {
		t.Skip("Test requires running as PID 1 (run in Docker)")
	}

	pid1Mgr := process.NewPID1Manager()
	pid1Mgr.SetPID1ForTesting(true)

	// Start the orphan reaper
	pid1Mgr.Start(nil)

	t.Run("orphaned child is reaped", func(t *testing.T) {
		// Create a parent process that spawns a child then exits
		// The child becomes an orphan and should be reaped by PID 1
		cmd := exec.Command("sh", "-c", "(sleep 2 &); exit 0")
		if err := cmd.Start(); err != nil {
			t.Fatalf("failed to start parent: %v", err)
		}

		parentPid := cmd.Process.Pid

		// Wait for parent to exit
		if err := cmd.Wait(); err != nil {
			t.Logf("parent exited with error: %v", err)
		}

		// Give the orphan a moment to be reparented
		time.Sleep(100 * time.Millisecond)

		// Find the orphaned sleep process
		orphanPid := findProcessByCommand(t, "sleep 2")
		if orphanPid == 0 {
			t.Fatal("could not find orphaned sleep process")
		}

		t.Logf("Parent PID: %d, Orphan PID: %d", parentPid, orphanPid)

		// Verify it's been reparented to us (PID 1)
		ppid := getParentPid(t, orphanPid)
		if ppid != 1 {
			t.Errorf("orphan PPID is %d, expected 1", ppid)
		}

		// Kill the orphan to create a zombie candidate
		_ = syscall.Kill(orphanPid, syscall.SIGKILL)

		// Give the reaper time to clean it up
		time.Sleep(500 * time.Millisecond)

		// Verify the zombie was reaped (process should be gone)
		if processExists(orphanPid) {
			state := getProcessState(t, orphanPid)
			if state == "Z" {
				t.Errorf("orphan PID %d is still a zombie after reaping", orphanPid)
			}
		}
	})

	t.Run("multiple orphans are reaped", func(t *testing.T) {
		// Spawn multiple orphans
		for i := range 3 {
			cmd := exec.Command("sh", "-c", "(sleep 3 &); exit 0")
			if err := cmd.Run(); err != nil {
				t.Logf("parent %d exited with error: %v", i, err)
			}
		}

		time.Sleep(200 * time.Millisecond)

		// Count orphaned sleep processes
		count := countProcessesByCommand(t, "sleep 3")
		if count != 3 {
			t.Errorf("expected 3 orphaned processes, found %d", count)
		}

		// Kill them all
		killProcessesByCommand(t, "sleep 3")

		// Give reaper time to clean up
		time.Sleep(500 * time.Millisecond)

		// Verify no zombies remain
		zombieCount := countZombies(t)
		if zombieCount > 0 {
			t.Errorf("found %d zombie processes after reaping", zombieCount)
		}
	})
}

func TestPID1TrackedVsOrphanedProcesses(t *testing.T) {
	// Skip if not running as PID 1
	if os.Getpid() != 1 {
		t.Skip("Test requires running as PID 1 (run in Docker)")
	}

	logMgr := logs.NewManager(100)
	pid1Mgr := process.NewPID1Manager()
	pid1Mgr.SetPID1ForTesting(true)
	pid1Mgr.Start(nil)

	t.Run("tracked process not reaped by orphan reaper", func(t *testing.T) {
		// Start a tracked process via ProcessManager
		pm := NewProcessManager(logMgr, pid1Mgr)
		if err := pm.Start(validation.ProcessStartRequest{Command: "sleep 5"}); err != nil {
			t.Fatalf("failed to start tracked process: %v", err)
		}

		pm.mu.RLock()
		trackedPid := pm.currentProcess.GetInfo().PID
		pm.mu.RUnlock()

		// Verify it's registered
		if !pid1Mgr.IsChildProcessTracked(trackedPid) {
			t.Errorf("process PID %d should be tracked", trackedPid)
		}

		// Clean up
		_ = pm.Stop(ProcessStopRequest{Signal: "SIGKILL", Timeout: 5})
		time.Sleep(100 * time.Millisecond)
	})
}

func TestPID1SignalForwarding(t *testing.T) {
	// Skip if not running as PID 1
	if os.Getpid() != 1 {
		t.Skip("Test requires running as PID 1 (run in Docker)")
	}

	pid1Mgr := process.NewPID1Manager()
	pid1Mgr.SetPID1ForTesting(true)
	pid1Mgr.SetSignalForwardingForTesting(true)

	// Note: Full signal forwarding tests are better done in Docker integration
	// This is mainly a placeholder for potential unit tests of signal handling
	t.Run("signal forwarding enabled", func(_ *testing.T) {
		// Signal forwarding is enabled by default, tested via Start() behavior
		// No direct accessor needed as it's verified through integration tests
	})
}

// Tests below run on any Linux machine (don't require PID 1)

func TestPID1Manager_LinuxSpecificCreation(t *testing.T) {
	// This test verifies Linux-specific PID1Manager behavior works
	pid1Mgr := process.NewPID1Manager()

	if pid1Mgr == nil {
		t.Fatal("process.NewPID1Manager() returned nil")
	}

	// Verify GetChildProcessCount works (indirectly tests childProcesses is initialized)
	if count := pid1Mgr.GetChildProcessCount(); count != 0 {
		t.Errorf("Expected 0 child processes, got %d", count)
	}

	// Note: isPID1 is internal state, tested through Start() behavior
}

func TestPID1Manager_ChildProcessRegistration(t *testing.T) {
	// Test child process registration (works on any Linux machine)
	logMgr := logs.NewManager(100)
	pid1Mgr := process.NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Start a simple process
	if err := pm.Start(validation.ProcessStartRequest{Command: "sleep 1"}); err != nil {
		t.Fatalf("failed to start process: %v", err)
	}

	time.Sleep(50 * time.Millisecond)

	// Check that process was registered
	pm.mu.RLock()
	processInfo := pm.currentProcess.GetInfo()
	pm.mu.RUnlock()

	if processInfo.PID == 0 {
		t.Fatal("process PID is 0")
	}

	// Verify it's registered with PID1 manager
	if !pid1Mgr.IsChildProcessTracked(processInfo.PID) {
		t.Errorf("process PID %d not registered with PID1 manager", processInfo.PID)
	}

	// Clean up
	_ = pm.Stop(ProcessStopRequest{Signal: "SIGKILL", Timeout: 5})
	time.Sleep(100 * time.Millisecond)

	// Verify unregistration
	if pid1Mgr.IsChildProcessTracked(processInfo.PID) {
		t.Errorf("process PID %d still registered after stop", processInfo.PID)
	}
}

func TestLinuxPortDiscovery_ActualImplementation(t *testing.T) {
	// Verify we're using the Linux implementation, not the fallback
	discovery := ports.NewDiscovery()

	if discovery == nil {
		t.Fatal("ports.NewDiscovery() returned nil")
	}

	// Note: We can't type assert since LinuxPortDiscovery is now unexported from ports package
	// Instead, we verify the discovery works by calling GetProcessPorts

	// Test with current process (should work on any Linux machine)
	ports, err := discovery.GetProcessPorts(os.Getpid())
	if err != nil {
		t.Errorf("GetProcessPorts failed: %v", err)
	}

	// We might not have any ports, but the call should succeed
	t.Logf("Found %d ports for current process", len(ports))
}

func TestLinuxPortDiscovery_ProcFilesystem(t *testing.T) {
	// Verify we can read /proc/net/tcp (Linux-specific)
	data, err := os.ReadFile("/proc/net/tcp")
	if err != nil {
		t.Fatalf("Cannot read /proc/net/tcp: %v (not on Linux?)", err)
	}

	if len(data) == 0 {
		t.Error("/proc/net/tcp is empty")
	}

	// Should have at least a header line
	lines := strings.Split(string(data), "\n")
	if len(lines) < 2 {
		t.Error("/proc/net/tcp should have at least a header line")
	}

	// Verify we can read our own /proc/PID/fd
	fdDir := fmt.Sprintf("/proc/%d/fd", os.Getpid())
	entries, err := os.ReadDir(fdDir)
	if err != nil {
		t.Fatalf("Cannot read %s: %v", fdDir, err)
	}

	if len(entries) == 0 {
		t.Error("Process should have at least some file descriptors")
	}

	t.Logf("Process has %d file descriptors", len(entries))
}

// Helper functions for Linux process inspection

func findProcessByCommand(_ *testing.T, cmd string) int {
	out, err := exec.Command("pgrep", "-f", cmd).Output()
	if err != nil {
		return 0
	}
	// pgrep returns PIDs separated by newlines
	pidStr := ""
	for _, b := range out {
		if b >= '0' && b <= '9' {
			pidStr += string(b)
		} else if b == '\n' && pidStr != "" {
			break // Get first PID only
		}
	}
	if pidStr == "" {
		return 0
	}
	pid := 0
	_, _ = fmt.Sscanf(pidStr, "%d", &pid)
	return pid
}

func getParentPid(_ *testing.T, pid int) int {
	// Read from /proc for reliability
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0
	}
	// Format: pid (comm) state ppid ...
	// Find the last ')' to skip over comm which may contain spaces/parens
	lastParen := -1
	for i := len(data) - 1; i >= 0; i-- {
		if data[i] == ')' {
			lastParen = i
			break
		}
	}
	if lastParen == -1 {
		return 0
	}
	// After ')', fields are: state ppid ...
	fields := strings.Fields(string(data[lastParen+1:]))
	if len(fields) >= 2 {
		ppid := 0
		_, _ = fmt.Sscanf(fields[1], "%d", &ppid)
		return ppid
	}
	return 0
}

func processExists(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}

func getProcessState(_ *testing.T, pid int) string {
	// Read from /proc for reliability
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return ""
	}
	// Find state character after comm
	lastParen := -1
	for i := len(data) - 1; i >= 0; i-- {
		if data[i] == ')' {
			lastParen = i
			break
		}
	}
	if lastParen == -1 || lastParen+2 >= len(data) {
		return ""
	}
	// State is first character after ') '
	fields := strings.Fields(string(data[lastParen+1:]))
	if len(fields) > 0 {
		return fields[0]
	}
	return ""
}

func countProcessesByCommand(_ *testing.T, cmd string) int {
	out, err := exec.Command("pgrep", "-c", "-f", cmd).Output()
	if err != nil {
		return 0
	}
	count := 0
	_, _ = fmt.Sscanf(string(out), "%d", &count)
	return count
}

func killProcessesByCommand(_ *testing.T, cmd string) {
	_ = exec.Command("pkill", "-9", "-f", cmd).Run()
}

func countZombies(_ *testing.T) int {
	// Read /proc to find zombie processes
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		// Check if directory name is a number (PID)
		pid := 0
		if _, err := fmt.Sscanf(entry.Name(), "%d", &pid); err != nil || pid == 0 {
			continue
		}
		// Read process state
		data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
		if err != nil {
			continue
		}
		// Check if state is 'Z' (zombie)
		lastParen := -1
		for i := len(data) - 1; i >= 0; i-- {
			if data[i] == ')' {
				lastParen = i
				break
			}
		}
		if lastParen != -1 && lastParen+2 < len(data) {
			fields := strings.Fields(string(data[lastParen+1:]))
			if len(fields) > 0 && fields[0] == "Z" {
				count++
			}
		}
	}
	return count
}

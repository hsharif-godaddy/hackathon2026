//go:build !windows

package processmanager

import (
	"errors"
	"os/exec"
	"syscall"
	"time"
)

// drainPollInterval is how often drainProcessGroup re-checks whether the
// group still has members. Short enough that the typical case (everyone
// already gone) returns within one tick; not so short that the poll loop
// burns CPU.
const drainPollInterval = 10 * time.Millisecond

// applyProcessGroup configures cmd so the spawned shell becomes its own
// process group leader (Setpgid). Combined with signalProcessGroup this lets
// us deliver signals to the entire subtree, not just the shell — important
// when the shell forks subprocesses (e.g., for `cmd1 && cmd2`, pipelines, or
// any user command that doesn't `exec` into a single binary).
func applyProcessGroup(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

// signalProcessGroup sends sig to every process in the process group led by
// pid. The shell registered with the supervisor is the group leader, so its
// pid equals the pgid.
func signalProcessGroup(pid int, sig syscall.Signal) error {
	return syscall.Kill(-pid, sig)
}

// drainProcessGroup waits up to gracePeriod for every process in pgid to
// exit. If the group still has members at that point, sends SIGKILL and
// waits up to hardCap more for the kernel to deliver and reap them.
//
// This exists because cmd.Wait() only reaps the group leader. A survivor
// that ignores or traps the initial signal — backgrounded subshells, pipeline
// tails with custom SIGTERM handlers — would otherwise be reparented to PID 1
// and keep holding ports/fds long after Stop returned successfully.
//
// PID-reuse caveat: callers must capture pgid while the leader is still
// alive. After the leader is reaped the kernel may recycle its PID, and a
// new unrelated process could land on the same numeric value and form its
// own pgid. The two budgets are intentionally short (a few hundred ms each)
// so this race window stays microscopic in practice.
func drainProcessGroup(pgid int, gracePeriod, hardCap time.Duration) {
	if pollGroupEmpty(pgid, gracePeriod) {
		return
	}
	_ = signalProcessGroup(pgid, syscall.SIGKILL)
	pollGroupEmpty(pgid, hardCap)
}

// pollGroupEmpty returns true once kill(-pgid, 0) reports ESRCH (group has
// no remaining members), or false if the budget expires first. A budget of
// zero performs exactly one check.
func pollGroupEmpty(pgid int, budget time.Duration) bool {
	deadline := time.Now().Add(budget)
	for {
		if errors.Is(signalProcessGroup(pgid, syscall.Signal(0)), syscall.ESRCH) {
			return true
		}
		if !time.Now().Before(deadline) {
			return false
		}
		time.Sleep(drainPollInterval)
	}
}

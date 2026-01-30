//go:build linux && amd64

package process

import (
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

const (
	orphanReaperIdleInterval   = 250 * time.Millisecond
	trackedProcessBackoffDelay = 25 * time.Millisecond
)

func (pm *PID1Manager) startOrphanReaper() {
	go pm.reapOrphanedChildren()
}

func (pm *PID1Manager) reapOrphanedChildren() {
	slog.Info("starting orphaned child process reaper")

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGCHLD)
	defer signal.Stop(sigCh)

	ticker := time.NewTicker(orphanReaperIdleInterval)
	defer ticker.Stop()

	for {
		select {
		case <-sigCh:
		case <-ticker.C:
		}

		pm.reapExitedChildren()
	}
}

func (pm *PID1Manager) reapExitedChildren() {
	for {
		var info siginfoChild
		err := waitidRetry(unix.P_ALL, 0, &info, unix.WEXITED|unix.WNOHANG|unix.WNOWAIT)
		if err != nil {
			if errors.Is(err, syscall.ECHILD) {
				return
			}

			slog.Warn("orphan reaper waitid error", "error", err)
			return
		}

		if info.Pid == 0 {
			return
		}

		pm.mu.RLock()
		_, tracked := pm.childProcesses[int(info.Pid)]
		pm.mu.RUnlock()

		if tracked {
			time.Sleep(trackedProcessBackoffDelay)
			continue
		}

		if err := waitidRetry(unix.P_PID, int(info.Pid), &info, unix.WEXITED); err != nil {
			if errors.Is(err, syscall.ECHILD) {
				continue
			}

			slog.Warn("failed to reap orphaned child process", "pid", info.Pid, "error", err)
			return
		}

		slog.Debug("reaped orphaned child process", "pid", info.Pid)
	}
}

func waitidRetry(idType int, pid int, info *siginfoChild, options int) error {
	for {
		err := unix.Waitid(idType, pid, siginfoToUnix(info), options, nil)
		if errors.Is(err, syscall.EINTR) {
			continue
		}
		return err
	}
}

func siginfoToUnix(info *siginfoChild) *unix.Siginfo {
	return (*unix.Siginfo)(unsafe.Pointer(info))
}

type siginfoChild struct {
	Signo  int32
	Errno  int32
	Code   int32
	_      int32
	Pid    int32
	UID    uint32
	Status int32
	_      [100]byte
}

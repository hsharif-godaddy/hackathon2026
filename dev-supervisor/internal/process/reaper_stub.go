//go:build !linux || !amd64

package process

func (pm *PID1Manager) startOrphanReaper() {
	// No-op: orphan reaping is only implemented for Linux
}

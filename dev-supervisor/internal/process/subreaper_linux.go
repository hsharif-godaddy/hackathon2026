//go:build linux

package process

import "golang.org/x/sys/unix"

func setChildSubreaper() error {
	return unix.Prctl(unix.PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)
}

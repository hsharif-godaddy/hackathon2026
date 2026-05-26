//go:build !linux

package process

func setChildSubreaper() error {
	return nil
}

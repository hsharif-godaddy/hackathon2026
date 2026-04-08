package preflight

import (
	"fmt"
	"net"
	"time"
)

// IsPortInUse checks whether a TCP port is in use on localhost.
func IsPortInUse(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 500*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

//go:build linux

package main

import "github.com/airo-ai-builder/dev-supervisor/internal/sandbox"

// defaultPaths returns the built-in system path rules that provide a working
// execution environment. These are prepended before user-specified paths when
// Defaults is true (the default).
//
// Paths are designed for multi-distro compatibility (Debian, Alpine, RHEL, SLES).
// Non-existent paths are silently skipped at Landlock apply time.
func defaultPaths() []sandbox.PathRule {
	return []sandbox.PathRule{
		// Binaries (read + execute)
		{Mode: "rx", Path: "/bin"},
		{Mode: "rx", Path: "/usr/bin"},
		{Mode: "rx", Path: "/usr/local/bin"},
		{Mode: "rx", Path: "/sbin"},
		{Mode: "rx", Path: "/usr/sbin"},

		// Shared libraries (read + execute)
		{Mode: "rx", Path: "/lib"},
		{Mode: "rx", Path: "/lib64"},
		{Mode: "rx", Path: "/usr/lib"},
		{Mode: "rx", Path: "/usr/lib64"}, // RHEL/SLES primary 64-bit path
		{Mode: "rx", Path: "/usr/local/lib"},
		{Mode: "rx", Path: "/usr/local/lib64"}, // RHEL local 64-bit libs
		{Mode: "rx", Path: "/usr/libexec"},     // RHEL helper binaries

		// Dynamic linker config (read)
		{Mode: "r", Path: "/etc/ld.so.conf"},
		{Mode: "r", Path: "/etc/ld.so.cache"},
		{Mode: "r", Path: "/etc/ld.so.conf.d"},

		// DNS and networking (read)
		{Mode: "r", Path: "/etc/hosts"},
		{Mode: "r", Path: "/etc/resolv.conf"},
		{Mode: "r", Path: "/etc/services"},
		{Mode: "r", Path: "/etc/protocols"},
		{Mode: "r", Path: "/etc/nsswitch.conf"},
		{Mode: "r", Path: "/etc/hostname"},

		// User/group lookup (read)
		{Mode: "r", Path: "/etc/passwd"},
		{Mode: "r", Path: "/etc/group"},

		// TLS certificates and OpenSSL config (read)
		// Debian/Alpine: /etc/ssl (includes openssl.cnf and certs/)
		// RHEL: /etc/pki/tls (OpenSSL), /etc/pki/ca-trust (CA store)
		{Mode: "r", Path: "/etc/ssl"},
		{Mode: "r", Path: "/etc/pki/tls"},
		{Mode: "r", Path: "/etc/pki/ca-trust"},

		// System crypto policies (read) — RHEL 8+
		// OpenSSL, GnuTLS, and NSS read these for algorithm/protocol config
		{Mode: "r", Path: "/etc/crypto-policies"},
		{Mode: "r", Path: "/usr/share/crypto-policies"},

		// Timezone/locale (read)
		{Mode: "r", Path: "/usr/share/zoneinfo"},
		{Mode: "r", Path: "/usr/share/locale"},
		{Mode: "r", Path: "/usr/share/common-licenses"},

		// Device files (specific files, NOT all of /dev)
		{Mode: "rw", Path: "/dev/null"},
		{Mode: "rw", Path: "/dev/zero"},
		{Mode: "rw", Path: "/dev/full"},
		{Mode: "rw", Path: "/dev/urandom"},
		{Mode: "rw", Path: "/dev/random"},
		// /dev/stdin, /dev/stdout, /dev/stderr, /dev/fd are symlinks into /proc/self/fd/
		// and cannot be opened for Landlock rules. They don't need rules anyway —
		// they're already-open inherited file descriptors that Landlock doesn't restrict.

		// Process information (read)
		// Many runtimes (Node.js, Go, Python) read /proc/self/fd, /proc/self/maps,
		// /proc/self/status, /proc/cpuinfo, /proc/meminfo, etc.
		{Mode: "r", Path: "/proc"},
	}
}

package docker

import (
	"fmt"
	"net"
	"os"
	"strings"

	"github.com/airo-ai-builder/local-control-plane/internal/agentsurl"
)

// resolveContainerHostIP returns the IP address preview/publish containers should
// use to reach dev services on the host (agents :4000, Gasket :8443).
//
// On WSL2 + Docker Desktop, Docker's host-gateway (192.168.65.254) cannot reach
// services bound in the WSL distro. We pin extra_hosts to the WSL eth0 address
// instead. On macOS and native Linux Docker, returns "" so compose keeps using
// the host-gateway magic token.
//
// Override with LOCAL_DEV_CONTAINER_HOST_IP when auto-detection is wrong.
func resolveContainerHostIP() string {
	switch ip := strings.TrimSpace(os.Getenv("LOCAL_DEV_CONTAINER_HOST_IP")); ip {
	case "", "disabled":
		if ip == "disabled" || !isWSL2() {
			return ""
		}
		return wslPrimaryIPv4()
	default:
		return ip
	}
}

func isWSL2() bool {
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(data)), "microsoft")
}

func wslPrimaryIPv4() string {
	if ip := interfaceIPv4("eth0"); ip != "" {
		return ip
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
			continue
		}
		if ip := firstIPv4(&iface); ip != "" {
			return ip
		}
	}
	return ""
}

func interfaceIPv4(name string) string {
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return ""
	}
	return firstIPv4(iface)
}

func firstIPv4(iface *net.Interface) string {
	addrs, err := iface.Addrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		ipNet, ok := addr.(*net.IPNet)
		if !ok || ipNet.IP.To4() == nil || ipNet.IP.IsLoopback() {
			continue
		}
		return ipNet.IP.String()
	}
	return ""
}

func hostGatewayTarget() string {
	if ip := resolveContainerHostIP(); ip != "" {
		return ip
	}
	return "host-gateway"
}

func formatExtraHosts(appURL string) string {
	target := hostGatewayTarget()
	lines := []string{
		fmt.Sprintf(`      - "host.docker.internal:%s"`, target),
	}
	if strings.Contains(appURL, "local.gasket.dev-godaddy.com") {
		lines = append(lines, fmt.Sprintf(`      - "local.gasket.dev-godaddy.com:%s"`, target))
	}
	return "    extra_hosts:\n" + strings.Join(lines, "\n")
}

// defaultAgentsBaseURL is a thin local-package alias for agentsurl.Default.
// Kept so callers in this package (and the existing host_gateway_test.go
// assertions) don't have to update import paths in one go.
func defaultAgentsBaseURL() string {
	return agentsurl.Default()
}

func defaultSMTPDestination() string {
	if ip := resolveContainerHostIP(); ip != "" {
		return fmt.Sprintf("%s:1025", ip)
	}
	return "host.docker.internal:1025"
}

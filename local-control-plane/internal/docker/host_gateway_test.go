package docker

import (
	"strings"
	"testing"
)

func TestFormatExtraHostsUsesHostGatewayByDefault(t *testing.T) {
	t.Setenv("LOCAL_DEV_CONTAINER_HOST_IP", "disabled")
	extraHosts := formatExtraHosts("https://airo-builder.test-godaddy.com")

	if !strings.Contains(extraHosts, `host.docker.internal:host-gateway`) {
		t.Errorf("expected host-gateway target, got:\n%s", extraHosts)
	}
	if strings.Contains(extraHosts, "local.gasket.dev-godaddy.com") {
		t.Error("expected no gasket host mapping for non-gasket app URL")
	}
}

func TestFormatExtraHostsGasketDomain(t *testing.T) {
	t.Setenv("LOCAL_DEV_CONTAINER_HOST_IP", "disabled")
	extraHosts := formatExtraHosts("https://local.gasket.dev-godaddy.com:8443")

	if !strings.Contains(extraHosts, `local.gasket.dev-godaddy.com:host-gateway`) {
		t.Errorf("expected gasket host mapping, got:\n%s", extraHosts)
	}
}

func TestFormatExtraHostsExplicitIPOverride(t *testing.T) {
	t.Setenv("LOCAL_DEV_CONTAINER_HOST_IP", "172.24.217.84")
	extraHosts := formatExtraHosts("https://local.gasket.dev-godaddy.com:8443")

	if !strings.Contains(extraHosts, `host.docker.internal:172.24.217.84`) {
		t.Errorf("expected explicit host IP, got:\n%s", extraHosts)
	}
	if !strings.Contains(extraHosts, `local.gasket.dev-godaddy.com:172.24.217.84`) {
		t.Errorf("expected explicit gasket host IP, got:\n%s", extraHosts)
	}
}

func TestDefaultAgentsBaseURLGasketHTTPS(t *testing.T) {
	t.Setenv("LOCAL_DEV_CONTAINER_HOST_IP", "10.1.2.3")
	t.Setenv("AGENTS_BASE_URL", "")

	if got := defaultAgentsBaseURL(); got != "https://local.gasket.dev-godaddy.com:4000" {
		t.Errorf("defaultAgentsBaseURL() = %q, want https://local.gasket.dev-godaddy.com:4000", got)
	}
}

func TestDefaultAgentsBaseURLEnvOverride(t *testing.T) {
	t.Setenv("LOCAL_DEV_CONTAINER_HOST_IP", "10.1.2.3")
	t.Setenv("AGENTS_BASE_URL", "http://custom:4000")

	if got := defaultAgentsBaseURL(); got != "http://custom:4000" {
		t.Errorf("defaultAgentsBaseURL() = %q, want env override", got)
	}
}

func TestDefaultSMTPDestinationExplicitIP(t *testing.T) {
	t.Setenv("LOCAL_DEV_CONTAINER_HOST_IP", "10.1.2.3")

	if got := defaultSMTPDestination(); got != "10.1.2.3:1025" {
		t.Errorf("defaultSMTPDestination() = %q, want 10.1.2.3:1025", got)
	}
}

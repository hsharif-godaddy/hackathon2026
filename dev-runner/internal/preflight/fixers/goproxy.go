package fixers

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// GoProxyFixer configures the Go toolchain to fetch private gdcorp modules
// through GoDaddy's Artifactory Go virtual repo.
//
// It requires a JFrog identity token, which the user provides via the TUI form.
// The token is persisted via `go env -w` so it survives across shells.
type GoProxyFixer struct {
	token string
}

func (f *GoProxyFixer) FormFields() []preflight.FormField {
	if npmrcAuthToken() != "" {
		return nil
	}
	return []preflight.FormField{
		{
			Key:         "token",
			Label:       "JFrog Identity Token",
			Description: "Generate at: https://gdartifactory1.jfrog.io/ui/user_profile",
			Required:    true,
			Password:    true,
		},
	}
}

// npmrcAuthToken extracts the JFrog _authToken from ~/.npmrc, if present.
func npmrcAuthToken() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(home, ".npmrc"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "gdartifactory1.jfrog.io") {
			if _, token, ok := strings.Cut(line, "_authToken="); ok {
				return strings.TrimSpace(token)
			}
		}
	}
	return ""
}

func (f *GoProxyFixer) SetFormValues(values map[string]string) {
	f.token = strings.TrimSpace(values["token"])
}

func (f *GoProxyFixer) Fix(ctx context.Context, _ string) error {
	currentProxy, _ := exec.CommandContext(ctx, "go", "env", "GOPROXY").Output()
	proxy := strings.TrimSpace(string(currentProxy))

	if strings.Contains(proxy, "gdartifactory1.jfrog.io") {
		return f.setAuxVars(ctx)
	}

	if f.token == "" {
		f.token = npmrcAuthToken()
	}
	if f.token == "" {
		return fmt.Errorf("no token provided")
	}

	proxyURL := fmt.Sprintf("https://:%s@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct", f.token)
	if err := goEnvWrite(ctx, "GOPROXY", proxyURL); err != nil {
		return fmt.Errorf("failed to set GOPROXY: %w", err)
	}

	return f.setAuxVars(ctx)
}

func (f *GoProxyFixer) setAuxVars(ctx context.Context) error {
	if err := goEnvWrite(ctx, "GONOPROXY", "none"); err != nil {
		return fmt.Errorf("failed to set GONOPROXY: %w", err)
	}
	if err := goEnvWrite(ctx, "GONOSUMDB", "github.com/gdcorp-*"); err != nil {
		return fmt.Errorf("failed to set GONOSUMDB: %w", err)
	}

	currentPrivate, _ := exec.CommandContext(ctx, "go", "env", "GOPRIVATE").Output()
	if strings.Contains(string(currentPrivate), "gdcorp-") {
		if err := goEnvUnset(ctx, "GOPRIVATE"); err != nil {
			return fmt.Errorf("failed to unset GOPRIVATE: %w", err)
		}
	}

	return nil
}

func goEnvWrite(ctx context.Context, key, value string) error {
	return exec.CommandContext(ctx, "go", "env", "-w", key+"="+value).Run()
}

func goEnvUnset(ctx context.Context, key string) error {
	return exec.CommandContext(ctx, "go", "env", "-u", key).Run()
}

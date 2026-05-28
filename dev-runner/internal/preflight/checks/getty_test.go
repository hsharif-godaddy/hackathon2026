package checks

import (
	"context"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestGettyCheck_SkipWhenNoGettySignals(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "NODE_ENV=development\n")

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip, got %v: %s", result.Status, result.Message)
	}
	if result.FixAvailable {
		t.Error("expected FixAvailable=false when Getty is not in scope")
	}
}

func TestGettyCheck_WithGettyURLOnlyNoDriver(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "GETTY_IMAGE_PROXY_URL=https://getty-images-proxy.api.test-godaddy.com\nUSE_S2S_AUTH=true\n")

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestGettyCheck_UnsplashWithGettyURLStillValidatesAuth(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "IMAGE_SEARCH_DRIVER=unsplash\nGETTY_IMAGE_PROXY_URL=https://example.com/getty\n")

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for missing auth, got %v: %s", result.Status, result.Message)
	}
}

func TestGettyCheck_EnabledWithS2S(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "IMAGE_SEARCH_DRIVER=getty\nUSE_S2S_AUTH=true\n")

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.Message, "Getty configured") {
		t.Errorf("expected message to confirm Getty configured, got: %s", result.Message)
	}
}

func TestGettyCheck_EnabledMissingS2SAuth(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "IMAGE_SEARCH_DRIVER=getty\n")

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true when auth vars are missing")
	}
	if !strings.Contains(result.Message, "USE_S2S_AUTH") {
		t.Errorf("expected message to mention USE_S2S_AUTH, got: %s", result.Message)
	}
}

func TestGettyCheck_LegacyGettyTokenWarns(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root,
		"IMAGE_SEARCH_DRIVER=getty\nUSE_S2S_AUTH=true\nGETTY_TOKEN=legacy\n",
	)

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for legacy GETTY_TOKEN, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.Message, "GETTY_TOKEN") {
		t.Errorf("expected message to mention GETTY_TOKEN, got: %s", result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true for legacy vars")
	}
}

func TestGettyCheck_LegacyGettyAPIURLWarns(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root,
		"IMAGE_SEARCH_DRIVER=getty\nUSE_S2S_AUTH=true\nGETTY_API_URL=https://old-proxy\n",
	)

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for legacy GETTY_API_URL, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.Message, "GETTY_API_URL") {
		t.Errorf("expected message to mention GETTY_API_URL, got: %s", result.Message)
	}
}

func TestGettyCheck_BothLegacyVarsWarn(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root,
		"IMAGE_SEARCH_DRIVER=getty\nUSE_S2S_AUTH=true\nGETTY_TOKEN=tok\nGETTY_API_URL=https://old\n",
	)

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.Message, "GETTY_TOKEN") || !strings.Contains(result.Message, "GETTY_API_URL") {
		t.Errorf("expected message to mention both legacy vars, got: %s", result.Message)
	}
}

func TestGettyCheck_ExplicitNonGettyDriver(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "IMAGE_SEARCH_DRIVER=unsplash\n")

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip, got %v: %s", result.Status, result.Message)
	}
}

func TestGettyCheck_MissingEnvFile(t *testing.T) {
	root := t.TempDir()

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip, got %v: %s", result.Status, result.Message)
	}
}

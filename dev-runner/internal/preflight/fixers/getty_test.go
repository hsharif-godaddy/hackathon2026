package fixers

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestGettyFixer_SetsDefaultAPIURL(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", "GOCODE_USE_S2S_AUTH=true\n")

	if err := (&GettyFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents", ".env"))
	if _, has := env["IMAGE_SEARCH_DRIVER"]; has {
		t.Error("Getty fixer should not set IMAGE_SEARCH_DRIVER")
	}
	if env["GETTY_IMAGE_PROXY_URL"] != defaultLocalGettyAPIURL {
		t.Errorf("GETTY_IMAGE_PROXY_URL=%q want %q", env["GETTY_IMAGE_PROXY_URL"], defaultLocalGettyAPIURL)
	}
}

func TestGettyFixer_DoesNotChangeImageSearchDriver(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", "IMAGE_SEARCH_DRIVER=unsplash\nGOCODE_USE_S2S_AUTH=true\n")

	if err := (&GettyFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix: %v", err)
	}
	env := readEnvMap(t, filepath.Join(root, "agents", ".env"))
	if env["IMAGE_SEARCH_DRIVER"] != "unsplash" {
		t.Errorf("IMAGE_SEARCH_DRIVER=%q want unsplash unchanged", env["IMAGE_SEARCH_DRIVER"])
	}
	if env["GETTY_IMAGE_PROXY_URL"] != defaultLocalGettyAPIURL {
		t.Errorf("GETTY_IMAGE_PROXY_URL=%q", env["GETTY_IMAGE_PROXY_URL"])
	}
}

func TestGettyFixer_PreservesExistingGettyAPIURL(t *testing.T) {
	root := t.TempDir()
	custom := "https://api.test-godaddy.com/getty-proxy"
	writeEnv(t, root, "agents", "GOCODE_USE_S2S_AUTH=true\nGETTY_IMAGE_PROXY_URL="+custom+"\n")

	if err := (&GettyFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents", ".env"))
	if env["GETTY_IMAGE_PROXY_URL"] != custom {
		t.Errorf("GETTY_IMAGE_PROXY_URL=%q want %q", env["GETTY_IMAGE_PROXY_URL"], custom)
	}
}

func TestGettyFixer_FillsBlankGettyAPIURL(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", "GOCODE_USE_S2S_AUTH=true\nGETTY_IMAGE_PROXY_URL=  \n")

	if err := (&GettyFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents", ".env"))
	if env["GETTY_IMAGE_PROXY_URL"] != defaultLocalGettyAPIURL {
		t.Errorf("GETTY_IMAGE_PROXY_URL=%q want %q", env["GETTY_IMAGE_PROXY_URL"], defaultLocalGettyAPIURL)
	}
}

func TestGettyFixer_MissingAuthErrorMentionsS2S(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", "NODE_ENV=development\n")

	err := (&GettyFixer{}).Fix(context.Background(), root)
	if err == nil {
		t.Fatal("expected error when GOCODE_USE_S2S_AUTH is not set")
	}
	s := err.Error()
	if !strings.Contains(s, "GOCODE_USE_S2S_AUTH") {
		t.Errorf("error should mention GOCODE_USE_S2S_AUTH:\n%s", s)
	}
}

func TestGettyFixer_WritesDefaultsEvenWhenAuthMissing(t *testing.T) {
	root := t.TempDir()
	err := (&GettyFixer{}).Fix(context.Background(), root)
	if err == nil {
		t.Fatal("expected error when GOCODE_USE_S2S_AUTH is not set")
	}
	env := readEnvMap(t, filepath.Join(root, "agents", ".env"))
	if _, has := env["IMAGE_SEARCH_DRIVER"]; has {
		t.Error("Getty fixer should not set IMAGE_SEARCH_DRIVER")
	}
	if env["GETTY_IMAGE_PROXY_URL"] != defaultLocalGettyAPIURL {
		t.Errorf("GETTY_IMAGE_PROXY_URL=%q want default even when auth fails", env["GETTY_IMAGE_PROXY_URL"])
	}
}

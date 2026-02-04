package httpproxy

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/airo-ai-builder/dev-supervisor/internal/proxy/routing"
)

// validateConfig validates the proxy configuration.
func (p *HTTPProxy) validateConfig() error {
	if p.config.ListenPort <= 0 || p.config.ListenPort > 65535 {
		return fmt.Errorf("invalid listen port: %d", p.config.ListenPort)
	}

	if p.config.TargetPort <= 0 || p.config.TargetPort > 65535 {
		return fmt.Errorf("invalid target port: %d", p.config.TargetPort)
	}

	if p.config.TargetHost == "" {
		return errors.New("target host cannot be empty")
	}

	// TLS certificates are optional - if provided, both cert and key must be specified
	hasCert := p.config.TLSCertPath != ""
	hasKey := p.config.TLSKeyPath != ""

	if hasCert != hasKey {
		return fmt.Errorf("both TLS certificate and key must be provided, or neither (cert=%q, key=%q)",
			p.config.TLSCertPath, p.config.TLSKeyPath)
	}

	// If TLS paths are provided, validate they exist
	if hasCert {
		if _, err := os.Stat(p.config.TLSCertPath); os.IsNotExist(err) {
			return fmt.Errorf("TLS certificate file not found: %s", p.config.TLSCertPath)
		}

		if _, err := os.Stat(p.config.TLSKeyPath); os.IsNotExist(err) {
			return fmt.Errorf("TLS key file not found: %s", p.config.TLSKeyPath)
		}
	}

	return nil
}

// validateStaticServingConfig validates static serving configuration after routing config is loaded.
func (p *HTTPProxy) validateStaticServingConfig(routingConfig routing.Config) error {
	if !p.config.EnableStaticServing {
		slog.Info("static file serving disabled, proxying all requests to backend")
		return nil
	}

	// Determine effective static root (from routingConfig or fallback to p.config)
	staticRoot := routingConfig.StaticRoot
	if staticRoot == "" {
		staticRoot = p.config.StaticRoot
	}

	if staticRoot == "" {
		return errors.New(
			"static root must be specified when static serving is enabled (via DEV_SUPERVISOR_STATIC_ROOT env var or static_root in routing config)",
		)
	}

	// Check if static root exists (warn but don't fail - directory may be created after startup)
	if _, err := os.Stat(staticRoot); os.IsNotExist(err) {
		slog.Warn("static root directory does not exist at startup, will be unavailable until created",
			"path", staticRoot)
	} else if routingConfig.SPAMode {
		// Only check index.html if directory exists and SPA mode is enabled
		indexPath := filepath.Join(staticRoot, "index.html")
		if _, err := os.Stat(indexPath); os.IsNotExist(err) {
			slog.Warn("index.html not found in static root, SPA fallback may not work",
				"path", indexPath)
		}
	}

	// Log whether using default or custom static root
	isDefault := staticRoot == "/app/dist/client"
	slog.Info("static file serving enabled",
		"root", staticRoot,
		"spa_mode", routingConfig.SPAMode,
		"using_default_root", isDefault)

	return nil
}

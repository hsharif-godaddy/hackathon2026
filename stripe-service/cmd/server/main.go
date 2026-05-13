// Command server is the stripe-service HTTP entrypoint. Wires AWS SDK
// clients, gd-auth S2S middleware, the Stripe client, and api.Server;
// applies graceful shutdown on SIGINT/SIGTERM.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/gdcorp-golang/auth/gdsso"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/api"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/awsclients"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/config"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/store"
	stripeclient "github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripe"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/webhook"
)

// version is set via -ldflags at build time. Defaults to "dev" for local builds.
var version = "dev"

func main() {
	setupLogger(bootstrapLogLevel(), bootstrapLogFormat())

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config.load", "error", err)
		os.Exit(1)
	}
	setupLogger(cfg.LogLevel, cfg.LogFormat)

	clients, err := awsclients.New(context.Background())
	if err != nil {
		slog.Error("stripe_service.awsclients.new", "error", err)
		os.Exit(1)
	}

	// Preflight the SSO client so a misconfigured SSO_HOST surfaces as a
	// loud startup failure rather than going through packages/go-auth's
	// silent reject-all fallback — where /health would still return 200
	// but every /v1/* request responds 401 "auth misconfigured". SSO
	// client creation is the realistic failure mode; gdhttp.NewHandler
	// errors (the other fallback paths) would indicate a go-auth bug
	// that affects all callers equally and belong in a shared-package
	// fix.
	if cfg.AuthType == "jwt" {
		if _, err := gdsso.NewClient(gdsso.WithHost(cfg.SSOHost)); err != nil {
			slog.Error("stripe_service.sso.preflight", "error", err, "ssoHost", cfg.SSOHost)
			os.Exit(1)
		}
	}
	authMW := goauth.NewMiddleware(cfg.AuthType, cfg.SSOHost)

	// Webhook signing secret is read once at startup. A misconfigured /
	// missing secret means we can't verify any webhook anyway, so failing
	// at boot is strictly better than silently 401-ing every Stripe
	// delivery for the lifetime of the process. ParseSigningSecret also
	// handles the CDK's JSON-wrapped form ({"signingSecret":"whsec_..."})
	// and rejects the unreplaced REPLACE_ME placeholder.
	resources := cfg.ResourceNames()
	rawSecret, err := clients.GetSecretValue(context.Background(), resources.WebhookSigningSecret)
	if err != nil {
		slog.Error("stripe_service.webhook.secret_load", "error", err, "secret", resources.WebhookSigningSecret)
		os.Exit(1)
	}
	whsec, err := webhook.ParseSigningSecret(rawSecret)
	if err != nil {
		slog.Error("stripe_service.webhook.secret_parse", "error", err, "secret", resources.WebhookSigningSecret)
		os.Exit(1)
	}
	verifier := webhook.NewVerifier(whsec)
	events := store.NewEvents(clients.DynamoDB(), resources.EventsTable)
	sandboxes := store.NewSandboxes(clients.DynamoDB(), resources.SandboxesTable)
	stripeClient := stripeclient.FakeClient{}

	srv := &api.Server{
		Environment:     string(cfg.Environment),
		Version:         version,
		Prober:          clients,
		ResourceNames:   resources,
		Auth:            authMW,
		Stripe:          stripeClient,
		Sandboxes:       sandboxes,
		Events:          events,
		WebhookVerifier: verifier,
	}
	handler := api.NewRouter(srv)

	httpSrv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      handler,
		ReadTimeout:  cfg.HTTPReadTimeout,
		WriteTimeout: cfg.HTTPWriteTimeout,
		IdleTimeout:  cfg.HTTPIdleTimeout,
	}

	slog.Info("stripe_service.start",
		"addr", cfg.Addr,
		"environment", cfg.Environment,
		"version", version,
		"tls", cfg.TLSCertPath != "" && cfg.TLSKeyPath != "",
		"authType", cfg.AuthType,
	)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	errCh := make(chan error, 1)
	tlsEnabled := cfg.TLSCertPath != "" && cfg.TLSKeyPath != ""
	go func() {
		var err error
		if tlsEnabled {
			err = httpSrv.ListenAndServeTLS(cfg.TLSCertPath, cfg.TLSKeyPath)
		} else {
			err = httpSrv.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case sig := <-quit:
		slog.Info("stripe_service.shutdown.signal", "signal", sig.String())
	case err := <-errCh:
		slog.Error("http.server", "error", err)
		os.Exit(1)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		slog.Error("stripe_service.shutdown.failed", "error", err)
		os.Exit(1)
	}
	slog.Info("stripe_service.stopped")
}

func bootstrapLogLevel() string {
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		return v
	}
	return "info"
}

func bootstrapLogFormat() string {
	if v := os.Getenv("LOG_FORMAT"); v != "" {
		return v
	}
	return "json"
}

func setupLogger(level, format string) {
	opts := &slog.HandlerOptions{Level: config.SlogLevel(level)}
	var handler slog.Handler
	if format == "text" {
		handler = slog.NewTextHandler(os.Stdout, opts)
	} else {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	}
	slog.SetDefault(slog.New(handler))
}

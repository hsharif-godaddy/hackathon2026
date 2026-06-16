// Command server is the stripe-service HTTP entrypoint. Wires AWS SDK
// clients, gd-auth S2S middleware, the Stripe client, and api.Server;
// applies graceful shutdown on SIGINT/SIGTERM.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/gdcorp-golang/auth/gdsso"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/api"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/awsclients"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/config"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/hosting"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/jwedecrypt"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/kmspubkey"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/store"
	stripeclient "github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripe"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripeapi"
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

	// Stripe client: STRIPE_CLIENT=real wires the live stripeapi-backed
	// client (loads the platform sk_*_* from Secrets Manager, fails fast
	// on a missing/placeholder secret); anything else (default) uses the
	// deterministic fake. config.parseStripeClient already coerces local
	// envs to "fake" so a stale env var can't accidentally hit Stripe.
	stripeClient, stripeAPIClient, err := buildStripeClient(cfg, clients, resources)
	if err != nil {
		slog.Error("stripe_service.stripe_client.build", "error", err, "stripeClient", cfg.StripeClient)
		os.Exit(1)
	}

	secretsClient, err := buildHostingClient(cfg)
	if err != nil {
		slog.Error("stripe_service.hosting.build", "error", err)
		os.Exit(1)
	}

	srv := &api.Server{
		Environment:         string(cfg.Environment),
		Version:             version,
		Prober:              clients,
		ResourceNames:       resources,
		Auth:                authMW,
		Stripe:              stripeClient,
		Sandboxes:           sandboxes,
		Secrets:             secretsClient,
		HostingProber:       secretsClient,
		Events:              events,
		WebhookVerifier:     verifier,
		EventFetcher:        stripeAPIClient, // nil when STRIPE_CLIENT=fake
		CustomerEmailLookup: secretsClient,   // *hosting.Client; nil when secretsClient is nil
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
		"stripeClient", cfg.StripeClient,
	)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	errCh := make(chan error, 1)
	// TLS is required in every deployed environment — config.Load enforces
	// SERVER_CERT_PATH and SERVER_KEY_PATH whenever ENVIRONMENT != local, so by
	// the time we get here, plain HTTP is reachable only with ENVIRONMENT=local
	// and both TLS paths empty. Listening explicitly on each branch (rather
	// than a tlsEnabled flag) keeps the security-sensitive choice grep-able and
	// removes any implicit fallback for a deployed instance.
	go func() {
		var err error
		switch {
		case cfg.TLSCertPath != "":
			err = httpSrv.ListenAndServeTLS(cfg.TLSCertPath, cfg.TLSKeyPath)
		case cfg.Environment == config.EnvLocal:
			err = httpSrv.ListenAndServe()
		default:
			// Defense-in-depth: config.Load should have already errored, but
			// if a future refactor weakens that check we refuse to start
			// rather than silently fall back to plain HTTP.
			err = fmt.Errorf("refusing to start: TLS is required when ENVIRONMENT=%s", cfg.Environment)
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

	// httpSrv.Shutdown drains in-flight HTTP requests but NOT goroutines those
	// handlers spawned. The webhook handler launches LiveKeysInFlight
	// goroutines on context.Background() to decouple Stripe-ACK latency from
	// the {KMS GetPublicKey, 3× apiKeys.create, 2× KMS Decrypt, hosting
	// UpdateSecrets} chain — without this Wait() a SIGTERM during deploy can
	// truncate that chain mid-call, leaving claim_status=live + live_account_id
	// committed in DDB while the alloc env still holds *_test_* values. The
	// dedup row blocks redelivery, so recovery falls to the manual path.
	// We bound the wait on shutdownCtx so a stuck mint doesn't block the
	// process from exiting beyond the configured shutdown budget.
	drained := make(chan struct{})
	go func() {
		srv.LiveKeysInFlight.Wait()
		close(drained)
	}()
	select {
	case <-drained:
		slog.Info("stripe_service.live_keys.drained")
	case <-shutdownCtx.Done():
		slog.Warn("stripe_service.live_keys.drain_timeout", "timeout", cfg.ShutdownTimeout)
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

// buildStripeClient resolves cfg.StripeClient to a concrete stripe.Client.
// The second return value is the underlying *stripeapi.Client, non-nil only
// when StripeClientReal so the caller can wire EventFetcher for webhook
// event expansion. Fake mode returns nil for the stripeapi client.
func buildStripeClient(cfg config.Config, clients *awsclients.Clients, resources config.ResourceNames) (stripeclient.Client, *stripeapi.Client, error) {
	switch cfg.StripeClient {
	case config.StripeClientFake:
		return stripeclient.FakeClient{}, nil, nil
	case config.StripeClientReal:
		// fall through to real-client construction below
	default:
		// parseStripeClient validates the enum at config.Load time, so this
		// is only reachable if a future enum value is added without updating
		// this switch. Fail loud rather than silently fall back to fake.
		return nil, nil, fmt.Errorf("unsupported StripeClient value %q", cfg.StripeClient)
	}

	// Test-mode platform key — required in every env. Drives the
	// claimableSandboxes.create call (Stripe preview API exists only in test
	// mode; live keys 404 against this endpoint). Hard fail on missing /
	// unparseable: sandbox creation is the entry point for every merchant.
	testAPIKey, err := loadPlatformKey(clients, resources.PlatformKeyTestSecret)
	if err != nil {
		return nil, nil, err
	}
	testSAPI, err := stripeapi.New(stripeapi.Config{
		APIKey:        testAPIKey,
		BaseURL:       cfg.StripeAPIBaseURL,
		StripeVersion: cfg.StripeAPIVersion,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("construct test-mode stripeapi client: %w", err)
	}

	// Live-mode platform key — optional in non-prod envs. Drives the
	// apiKeys.create call against a claimed live merchant account. If the
	// secret is missing or still holds the CDK placeholder, log + proceed
	// with nil; MintLiveAPIKeys returns a clear error if invoked. Lets
	// dev/test envs that haven't populated the live key yet still boot
	// and exercise the sandbox-creation half of the flow.
	var liveSAPI *stripeapi.Client
	liveAPIKey, liveErr := loadPlatformKey(clients, resources.PlatformKeyLiveSecret)
	switch {
	case liveErr == nil:
		liveSAPI, err = stripeapi.New(stripeapi.Config{
			APIKey:        liveAPIKey,
			BaseURL:       cfg.StripeAPIBaseURL,
			StripeVersion: cfg.StripeAPIVersion,
		})
		if err != nil {
			return nil, nil, fmt.Errorf("construct live-mode stripeapi client: %w", err)
		}
	default:
		// Treat any failure (NotFound, placeholder, parse error) as
		// "live-key flow not enabled in this env" rather than a fatal.
		// MintLiveAPIKeys will surface a clear error on first call.
		slog.Warn("stripe_service.platform_key.live.unavailable",
			"secret", resources.PlatformKeyLiveSecret,
			"reason", liveErr.Error(),
			"effect", "live-key minting disabled until secret is populated; sandbox creation still works")
	}

	// kmspubkey.Cache + jwedecrypt.Decrypter together implement Stripe's
	// Managed API Keys protocol on the receiving side: pubkey ships outbound
	// on apiKeys.create requests so Stripe can wrap the CEK; the decrypter
	// then unwraps the CEK via KMS and AES-256-GCM-decrypts the content.
	// Both are lazy — no AWS calls happen here, only at first use.
	pemCache, err := kmspubkey.New(clients.KMS(), resources.ManagedKeysAlias)
	if err != nil {
		return nil, nil, fmt.Errorf("construct kmspubkey cache for %s: %w", resources.ManagedKeysAlias, err)
	}
	decrypter, err := jwedecrypt.New(clients.KMS(), resources.ManagedKeysAlias)
	if err != nil {
		return nil, nil, fmt.Errorf("construct jwedecrypt decrypter for %s: %w", resources.ManagedKeysAlias, err)
	}

	real, err := stripeclient.NewRealClient(testSAPI, liveSAPI, pemCache, decrypter)
	if err != nil {
		return nil, nil, fmt.Errorf("construct real stripe client: %w", err)
	}
	// EventFetcher uses the test-mode client: webhook events for the sandbox
	// lifecycle (claimable_sandbox.*) live in test mode, where this client
	// is authorized.
	return real, testSAPI, nil
}

// loadPlatformKey fetches a secret from Secrets Manager and validates it as a
// raw or JSON-wrapped Stripe platform key. Returns a wrapped error suitable
// for either fatal-on-startup (test key, always required) or warn-and-skip
// (live key, optional in non-prod envs) handling at the call site.
func loadPlatformKey(clients *awsclients.Clients, secretName string) (string, error) {
	raw, err := clients.GetSecretValue(context.Background(), secretName)
	if err != nil {
		return "", fmt.Errorf("load platform key from %s: %w", secretName, err)
	}
	apiKey, err := stripeclient.ParsePlatformKey(raw)
	if err != nil {
		return "", fmt.Errorf("parse platform key from %s: %w", secretName, err)
	}
	return apiKey, nil
}

// buildHostingClient constructs the outbound hosting.Client from cfg.Hosting.
// BaseURL is always set by config.Load (local default or explicit env var),
// so this never returns nil.
func buildHostingClient(cfg config.Config) (*hosting.Client, error) {
	var auth hosting.AuthProvider
	switch cfg.Hosting.Auth {
	case "awsiam":
		gd, err := gdauth.New(
			gdauth.WithApp("stripe-service"),
			gdauth.WithClient("airo-builder-stripe-service.api.int.godaddy.com"),
			gdauth.WithPCPID("8606"),
			gdauth.WithTestMode(false),
		)
		if err != nil {
			return nil, fmt.Errorf("hosting: init gd-auth: %w", err)
		}
		a, err := hosting.NewAwsIamAuth(gd, cfg.SSOHost)
		if err != nil {
			return nil, fmt.Errorf("hosting: init aws-iam auth: %w", err)
		}
		auth = a
	case "cert":
		a, err := hosting.NewCertSSOAuth(cfg.SSOHost, []byte(cfg.Hosting.ClientCert), []byte(cfg.Hosting.ClientKey))
		if err != nil {
			return nil, fmt.Errorf("hosting: init cert auth: %w", err)
		}
		auth = a
	default:
		auth = hosting.NoopAuth{}
	}
	return hosting.New(hosting.Config{
		BaseURL: cfg.Hosting.BaseURL,
		Auth:    auth,
		Timeout: cfg.Hosting.Timeout,
	})
}

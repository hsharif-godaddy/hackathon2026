// Command server is the budget-service HTTP entrypoint.
package main

import (
	"context"
	"crypto/tls"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	gotel "github.com/gdcorp-engineering/observability-go-otel"
	otelconfig "github.com/gdcorp-engineering/observability-go-otel/config"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/api"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/auth"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/config"
	schemamigrate "github.com/gdcorp-partners/airo-app-builder/budget-service/internal/migrate"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/observability"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/worker"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
	"go.opentelemetry.io/contrib/instrumentation/runtime"
)

func main() {
	dotenvErr := godotenv.Load()

	setupLogger(bootstrapLogLevel())

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config.load", "error", err)
		os.Exit(1)
	}
	setupLogger(cfg.LogLevel)
	if dotenvErr != nil {
		slog.Debug("budget_service.dotenv", "message", "no .env file or read error", "error", dotenvErr)
	}

	// Initialize OTel (tracer + metrics)
	otelCfg, otelCfgErr := otelconfig.NewOtelConfig(cfg.OTelServiceName, cfg.OTelServiceVersion, cfg.OTelEnvironment, cfg.OTelCloudPlatform)
	if otelCfgErr != nil {
		slog.Warn("otel.config.failed", "error", otelCfgErr)
	}
	var otelClient *gotel.OtelClient
	if otelCfg != nil {
		oc, otelInitErr := gotel.NewOtelClient(context.Background(), otelCfg)
		if otelInitErr != nil {
			slog.Warn("otel.client.init.failed", "error", otelInitErr)
		} else {
			otelClient = oc
		}
	}
	if otelClient != nil {
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := otelClient.Shutdown(ctx); err != nil {
				slog.Warn("otel.shutdown.failed", "error", err)
			}
		}()
		if err := runtime.Start(); err != nil {
			slog.Warn("otel.runtime.metrics.failed", "error", err)
		}
	}

	var sqlDB *sql.DB
	var st *store.Store
	if cfg.DatabaseURL != "" {
		// Pool + ping; failed ping still starts (degraded /health).
		dbHost := "unknown"
		if u, err := url.Parse(cfg.DatabaseURL); err == nil && u.Host != "" {
			dbHost = u.Hostname()
		}
		connectStart := time.Now()
		sqlDB, err = sql.Open("postgres", cfg.DatabaseURL)
		if err != nil {
			slog.Error("database.connect.failed", "error", err, "host", dbHost)
			os.Exit(1)
		}
		defer sqlDB.Close()
		sqlDB.SetMaxOpenConns(cfg.DBMaxOpenConns)
		sqlDB.SetMaxIdleConns(cfg.DBMaxIdleConns)
		sqlDB.SetConnMaxLifetime(cfg.DBConnMaxLifetime)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		pingErr := sqlDB.PingContext(ctx)
		cancel()
		if pingErr != nil {
			slog.Warn("database.ping.initial.failed", "error", pingErr, "host", dbHost)
		} else {
			slog.Info("database.connected", "host", dbHost, "elapsed", time.Since(connectStart).String())
			if cfg.AutoMigrate {
				migrateURL := cfg.MigrateDatabaseURL
				if migrateURL == "" {
					migrateURL = cfg.DatabaseURL
				}
				migrateHost := dbHost
				if u, err := url.Parse(migrateURL); err == nil && u.Host != "" {
					migrateHost = u.Hostname()
				}
				migrateStart := time.Now()
				if err := schemamigrate.Up(migrateURL); err != nil {
					slog.Error("database.migrate.failed", "error", err, "migrateHost", migrateHost, "poolHost", dbHost)
					os.Exit(1)
				}
				slog.Info("database.migrate.done", "migrateHost", migrateHost, "poolHost", dbHost, "elapsed", time.Since(migrateStart).String())
			}
		}
		st = store.New(sqlDB)
	} else {
		// Handlers use requireStore for writes; /health reports unconfigured.
		slog.Info("database.disabled", "message", "DATABASE_URL not set; /health reports database unconfigured")
	}

	if sqlDB != nil && otelClient != nil {
		if err := observability.RegisterDBMetrics(sqlDB); err != nil {
			slog.Warn("database.metrics.register.failed", "error", err)
		}
	}

	authType := "jwt"
	if cfg.LocalAuthDisable {
		authType = "none"
	}

	// Initialize singleton GDAuth client (used by middleware, token generator, and auth validator)
	if !cfg.LocalAuthDisable {
		if err := auth.InitClient(cfg.SSOHost); err != nil {
			slog.Error("auth.client.init.failed", "error", err)
			os.Exit(1)
		}
	}

	authMW := auth.NewMiddleware(authType, cfg.AuthAllowedRoles, cfg.AuthAllowedCerts)

	// Token generator is required for webhook delivery when auth is enabled.
	// Fail fast at startup if token generation is not working.
	// Use api.TokenProvider (nil interface) when disabled — do not assign (*TokenGenerator)(nil)
	// or getHealth's `TokenGenerator != nil` is true (typed nil) and Healthy() panics.
	var tokenGen api.TokenProvider
	if !cfg.LocalAuthDisable {
		tg, err := auth.NewTokenGenerator()
		if err != nil {
			slog.Error("token_generator.init.failed", "error", err)
			os.Exit(1)
		}
		tokenGen = tg
	}

	srv := &api.Server{Store: st, LocalAuthDisable: cfg.LocalAuthDisable, LogRequestBodies: cfg.LogRequestBodies}
	if tokenGen != nil {
		srv.TokenGenerator = tokenGen
	}
	handler := api.NewRouter(srv, authMW)
	if otelClient != nil {
		handler = otelClient.Metrics.MetricsMiddleware(handler)
		handler = otelClient.Tracer.TracingMiddleware(handler)
	}

	// Start background worker for periodic resets and expirations
	var workerCancel context.CancelFunc
	var workerWg sync.WaitGroup
	if cfg.WorkerEnabled && st != nil {
		workerCtx, cancel := context.WithCancel(context.Background())
		workerCancel = cancel
		w := worker.New(st, srv, cfg.WorkerInterval, cfg.WorkerBatchSize,
			cfg.OutboxDrainBatchSize, cfg.OutboxMaxAttempts, cfg.OutboxRetentionDays)
		workerWg.Add(1)
		go func() {
			defer workerWg.Done()
			w.Run(workerCtx)
		}()
	} else if !cfg.WorkerEnabled {
		slog.Info("worker.disabled", "message", "WORKER_ENABLED is false")
	}

	httpSrv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      handler,
		ReadTimeout:  cfg.HTTPReadTimeout,
		WriteTimeout: cfg.HTTPWriteTimeout,
		IdleTimeout:  cfg.HTTPIdleTimeout,
	}

	slog.Info("budget_service.start", "addr", cfg.Addr)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	errCh := make(chan error, 1)
	if cfg.TLSCertPath != "" && cfg.TLSKeyPath != "" {
		cert, err := tls.LoadX509KeyPair(cfg.TLSCertPath, cfg.TLSKeyPath)
		if err != nil {
			slog.Error("tls.keypair.load_failed", "certPath", cfg.TLSCertPath, "keyPath", cfg.TLSKeyPath, "error", err)
			os.Exit(1)
		}
		httpSrv.TLSConfig = &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS13,
		}
	}

	go func() {
		var listenErr error
		if httpSrv.TLSConfig != nil {
			slog.Info("budget_service.listen.tls", "addr", cfg.Addr, "localAuthDisable", cfg.LocalAuthDisable, "certPath", cfg.TLSCertPath)
			listenErr = httpSrv.ListenAndServeTLS("", "")
		} else {
			slog.Info("budget_service.listen", "addr", cfg.Addr, "localAuthDisable", cfg.LocalAuthDisable)
			listenErr = httpSrv.ListenAndServe()
		}
		if listenErr != nil && !errors.Is(listenErr, http.ErrServerClosed) {
			errCh <- listenErr
		}
	}()

	select {
	case sig := <-quit:
		slog.Info("budget_service.shutdown.signal", "signal", sig.String())
	case err := <-errCh:
		slog.Error("http.server", "error", err)
		os.Exit(1)
	}

	// Stop background worker and wait for in-flight work to finish
	if workerCancel != nil {
		workerCancel()
		workerWg.Wait()
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	errShutdown := httpSrv.Shutdown(shutdownCtx)
	shutdownCancel()
	if errShutdown != nil {
		slog.Error("budget_service.shutdown.failed", "error", errShutdown)
		os.Exit(1)
	}

	slog.Info("budget_service.stopped")
}

func bootstrapLogLevel() string {
	s := strings.TrimSpace(os.Getenv("LOG_LEVEL"))
	if s == "" {
		return "info"
	}
	return s
}

func setupLogger(level string) {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: config.SlogLevel(level)})
	slog.SetDefault(slog.New(handler))
}

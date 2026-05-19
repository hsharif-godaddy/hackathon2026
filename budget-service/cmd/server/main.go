// Command server is the budget-service HTTP entrypoint.
package main

import (
	"context"
	"crypto/tls"
	"database/sql"
	"errors"
	"fmt"
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
	if err := run(); err != nil {
		os.Exit(1)
	}
}

func run() error {
	dotenvErr := godotenv.Load()

	setupLogger(bootstrapLogLevel())

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config.load", "error", err)
		return fmt.Errorf("config.load: %w", err)
	}
	setupLogger(cfg.LogLevel)
	if dotenvErr != nil {
		slog.Debug("budget_service.dotenv", "message", "no .env file or read error", "error", dotenvErr)
	}

	otelClient := initOTel(&cfg)
	if otelClient != nil {
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := otelClient.Shutdown(ctx); err != nil {
				slog.Warn("otel.shutdown.failed", "error", err)
			}
		}()
	}

	sqlDB, st, err := initDatabase(&cfg)
	if err != nil {
		return err
	}
	if sqlDB != nil {
		defer sqlDB.Close()
	}

	if sqlDB != nil && otelClient != nil {
		if err := observability.RegisterDBMetrics(sqlDB); err != nil {
			slog.Warn("database.metrics.register.failed", "error", err)
		}
	}

	authMW, tokenGen, err := initAuth(&cfg)
	if err != nil {
		return err
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

	workerCancel, workerWg := initWorker(&cfg, st, srv)

	httpSrv, err := buildHTTPServer(&cfg, handler)
	if err != nil {
		slog.Error("tls.keypair.load_failed", "certPath", cfg.TLSCertPath, "keyPath", cfg.TLSKeyPath, "error", err)
		return err
	}

	slog.Info("budget_service.start", "addr", cfg.Addr, "localAuthDisable", cfg.LocalAuthDisable)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	errCh := make(chan error, 1)
	go func() {
		if listenErr := listenAndServe(httpSrv); listenErr != nil {
			errCh <- listenErr
		}
	}()

	select {
	case sig := <-quit:
		slog.Info("budget_service.shutdown.signal", "signal", sig.String())
	case err := <-errCh:
		slog.Error("http.server", "error", err)
		return err
	}

	if err := shutdownServer(httpSrv, workerCancel, workerWg, 15*time.Second); err != nil {
		slog.Error("budget_service.shutdown.failed", "error", err)
		return err
	}

	slog.Info("budget_service.stopped")
	return nil
}

func initOTel(cfg *config.Config) *gotel.OtelClient {
	otelCfg, otelCfgErr := otelconfig.NewOtelConfig(cfg.OTelServiceName, cfg.OTelServiceVersion, cfg.OTelEnvironment, cfg.OTelCloudPlatform)
	if otelCfgErr != nil {
		slog.Warn("otel.config.failed", "error", otelCfgErr)
		return nil
	}
	if otelCfg == nil {
		return nil
	}
	oc, otelInitErr := gotel.NewOtelClient(context.Background(), otelCfg)
	if otelInitErr != nil {
		slog.Warn("otel.client.init.failed", "error", otelInitErr)
		return nil
	}
	if err := runtime.Start(); err != nil {
		slog.Warn("otel.runtime.metrics.failed", "error", err)
	}
	return oc
}

func initDatabase(cfg *config.Config) (*sql.DB, *store.Store, error) {
	if cfg.DatabaseURL == "" {
		slog.Info("database.disabled", "message", "DATABASE_URL not set; /health reports database unconfigured")
		return nil, nil, nil
	}

	sqlDB, err := openDatabase(cfg)
	if err != nil {
		return nil, nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	pingErr := sqlDB.PingContext(ctx)
	cancel()

	dbHost := dbHostname(cfg.DatabaseURL)
	if pingErr != nil {
		slog.Warn("database.ping.initial.failed", "error", pingErr, "host", dbHost)
	} else {
		slog.Info("database.connected", "host", dbHost)
		if cfg.AutoMigrate {
			if err := runMigrations(cfg, dbHost); err != nil {
				_ = sqlDB.Close()
				return nil, nil, err
			}
		}
	}
	return sqlDB, store.New(sqlDB), nil
}

func runMigrations(cfg *config.Config, dbHost string) error {
	migrateURL := resolveMigrateURL(cfg)
	migrateHost := dbHostname(migrateURL)
	migrateStart := time.Now()
	if err := schemamigrate.Up(migrateURL); err != nil {
		slog.Error("database.migrate.failed", "error", err, "migrateHost", migrateHost, "poolHost", dbHost)
		return err
	}
	slog.Info("database.migrate.done", "migrateHost", migrateHost, "poolHost", dbHost, "elapsed", time.Since(migrateStart).String())
	return nil
}

func initAuth(cfg *config.Config) (*auth.Middleware, api.TokenProvider, error) {
	authType := "jwt"
	if cfg.LocalAuthDisable {
		authType = "none"
	}

	if !cfg.LocalAuthDisable {
		if err := auth.InitClient(cfg.SSOHost); err != nil {
			slog.Error("auth.client.init.failed", "error", err)
			return nil, nil, err
		}
	}

	authMW := auth.NewMiddleware(authType, cfg.AuthAllowedRoles, cfg.AuthAllowedCerts)

	// Use api.TokenProvider (nil interface) when disabled — do not assign (*TokenGenerator)(nil)
	// or getHealth's `TokenGenerator != nil` is true (typed nil) and Healthy() panics.
	var tokenGen api.TokenProvider
	if !cfg.LocalAuthDisable {
		tg, err := auth.NewTokenGenerator()
		if err != nil {
			slog.Error("token_generator.init.failed", "error", err)
			return nil, nil, err
		}
		tokenGen = tg
	}

	return authMW, tokenGen, nil
}

func initWorker(cfg *config.Config, st *store.Store, srv *api.Server) (context.CancelFunc, *sync.WaitGroup) {
	var workerWg sync.WaitGroup
	if cfg.WorkerEnabled && st != nil {
		workerCtx, cancel := context.WithCancel(context.Background())
		w := worker.New(st, srv, cfg.WorkerInterval, cfg.WorkerBatchSize,
			cfg.OutboxDrainBatchSize, cfg.OutboxMaxAttempts, cfg.OutboxRetentionDays)
		workerWg.Add(1)
		go func() {
			defer workerWg.Done()
			w.Run(workerCtx)
		}()
		return cancel, &workerWg
	}
	if !cfg.WorkerEnabled {
		slog.Info("worker.disabled", "message", "WORKER_ENABLED is false")
	}
	return nil, &workerWg
}

func dbHostname(databaseURL string) string {
	if u, err := url.Parse(databaseURL); err == nil && u.Host != "" {
		return u.Hostname()
	}
	return "unknown"
}

func resolveMigrateURL(cfg *config.Config) string {
	if cfg.MigrateDatabaseURL != "" {
		return cfg.MigrateDatabaseURL
	}
	return cfg.DatabaseURL
}

func openDatabase(cfg *config.Config) (*sql.DB, error) {
	dbHost := dbHostname(cfg.DatabaseURL)
	connectStart := time.Now()
	sqlDB, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		slog.Error("database.connect.failed", "error", err, "host", dbHost)
		return nil, err
	}
	sqlDB.SetMaxOpenConns(cfg.DBMaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.DBMaxIdleConns)
	sqlDB.SetConnMaxLifetime(cfg.DBConnMaxLifetime)
	slog.Debug("database.pool.configured", "host", dbHost, "elapsed", time.Since(connectStart).String())
	return sqlDB, nil
}

func buildHTTPServer(cfg *config.Config, handler http.Handler) (*http.Server, error) {
	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      handler,
		ReadTimeout:  cfg.HTTPReadTimeout,
		WriteTimeout: cfg.HTTPWriteTimeout,
		IdleTimeout:  cfg.HTTPIdleTimeout,
	}
	if cfg.TLSCertPath != "" && cfg.TLSKeyPath != "" {
		cert, err := tls.LoadX509KeyPair(cfg.TLSCertPath, cfg.TLSKeyPath)
		if err != nil {
			return nil, err
		}
		srv.TLSConfig = &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS13,
		}
	}
	return srv, nil
}

func listenAndServe(srv *http.Server) error {
	var err error
	if srv.TLSConfig != nil {
		err = srv.ListenAndServeTLS("", "")
	} else {
		err = srv.ListenAndServe()
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func shutdownServer(srv *http.Server, workerCancel context.CancelFunc, workerWg *sync.WaitGroup, timeout time.Duration) error {
	if workerCancel != nil {
		workerCancel()
	}
	if workerWg != nil {
		workerWg.Wait()
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return srv.Shutdown(ctx)
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

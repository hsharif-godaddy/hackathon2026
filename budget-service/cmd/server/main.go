// Command server is the budget-service HTTP entrypoint.
package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/api"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/auth"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/config"
	schemamigrate "github.com/gdcorp-partners/airo-app-builder/budget-service/internal/migrate"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

func main() {
	dotenvErr := godotenv.Load()

	cfg, err := config.Load()
	if err != nil {
		slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})).
			Error("config.load", "error", err)
		os.Exit(1)
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: authSlogLevel(cfg.AuthLogLevel),
	})))
	if dotenvErr != nil {
		slog.Debug("budget_service.dotenv", "message", "no .env file or read error", "error", dotenvErr)
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

	authMW := auth.NewMiddleware(authType)

	// Token generator is required for webhook delivery when auth is enabled.
	// Fail fast at startup if token generation is not working.
	var tokenGen *auth.TokenGenerator
	if !cfg.LocalAuthDisable {
		var err error
		tokenGen, err = auth.NewTokenGenerator()
		if err != nil {
			slog.Error("token_generator.init.failed", "error", err)
			os.Exit(1)
		}
	}

	srv := &api.Server{Store: st, TokenGenerator: tokenGen, LocalAuthDisable: cfg.LocalAuthDisable}
	handler := api.NewRouter(srv, authMW)

	httpSrv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      handler,
		ReadTimeout:  cfg.HTTPReadTimeout,
		WriteTimeout: cfg.HTTPWriteTimeout,
		IdleTimeout:  cfg.HTTPIdleTimeout,
	}

	var listenErr error
	// App TLS when SERVER_CERT_PATH and SERVER_KEY_PATH are both set.
	if cfg.TLSCertPath != "" && cfg.TLSKeyPath != "" {
		slog.Info("budget_service.listen.tls", "addr", cfg.Addr, "localAuthDisable", cfg.LocalAuthDisable, "certPath", cfg.TLSCertPath)
		listenErr = httpSrv.ListenAndServeTLS(cfg.TLSCertPath, cfg.TLSKeyPath)
	} else {
		slog.Info("budget_service.listen", "addr", cfg.Addr, "localAuthDisable", cfg.LocalAuthDisable)
		listenErr = httpSrv.ListenAndServe()
	}
	// Ignore ErrServerClosed until graceful shutdown exists.
	if listenErr != nil && listenErr != http.ErrServerClosed {
		slog.Error("http.server", "error", listenErr)
		os.Exit(1)
	}
}

func authSlogLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

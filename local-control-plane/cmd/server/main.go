package main

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/api"
	"github.com/airo-ai-builder/local-control-plane/internal/auth"
	"github.com/airo-ai-builder/local-control-plane/internal/docker"
	"github.com/airo-ai-builder/local-control-plane/internal/store"

	"github.com/rs/cors"
)

func main() {
	if err := run(); err != nil {
		slog.Error("startup failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	loadDotenv(".env")

	port := os.Getenv("PORT")
	if port == "" {
		port = "4100"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "local-control-plane.db"
	}

	logFile, err := os.Create("dev.log")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not create dev.log: %v\n", err)
		logFile = nil
	}
	if logFile != nil {
		defer func() { _ = logFile.Close() }()
	}

	var logWriter io.Writer = os.Stdout
	if logFile != nil {
		logWriter = io.MultiWriter(os.Stdout, logFile)
		fmt.Printf("📝 Logging output to dev.log\n")
	}

	logger := slog.New(slog.NewTextHandler(logWriter, &slog.HandlerOptions{Level: slog.LevelDebug}))
	slog.SetDefault(logger)

	db, err := store.Open(dbPath)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() { _ = db.Close() }()

	if !docker.IsDockerAvailable() {
		return errors.New("docker daemon is not running; start Docker Desktop and try again")
	}

	jwtService, err := auth.New()
	if err != nil {
		return fmt.Errorf("jwt init failed (run: aws sso login --profile %s): %w", awsProfile(), err)
	}

	docker.NewManager().Reconcile(db)

	authType := getEnv("AUTH_TYPE", "none")
	ssoHost := getEnv("SSO_HOST", "sso.dev-godaddy.com")
	ssoMW, err := auth.NewSSOMiddleware(authType, ssoHost)
	if err != nil {
		return fmt.Errorf("sso init failed: %w", err)
	}

	router := api.NewRouter(db, jwtService, ssoMW)

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	}).Handler(router)

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		slog.Info("shutting down")
		_ = server.Close()
	}()

	slog.Info("local-control-plane starting", "port", port, "db", dbPath, "auth_type", authType)
	fmt.Printf("\n  Local Control Plane running at http://localhost:%s\n\n", port)

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("server error: %w", err)
	}
	return nil
}

func awsProfile() string {
	return getEnv("AWS_PROFILE", "airobuild-dev-private-sso")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func loadDotenv(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		if len(val) >= 2 && (val[0] == '"' && val[len(val)-1] == '"' || val[0] == '\'' && val[len(val)-1] == '\'') {
			val = val[1 : len(val)-1]
		} else if idx := strings.Index(val, " #"); idx != -1 {
			val = strings.TrimSpace(val[:idx])
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, val)
		}
	}
}

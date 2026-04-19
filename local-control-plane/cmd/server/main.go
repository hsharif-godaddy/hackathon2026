package main

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/airo-ai-builder/local-control-plane/internal/api"
	"github.com/airo-ai-builder/local-control-plane/internal/auth"
	"github.com/airo-ai-builder/local-control-plane/internal/docker"
	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/rs/cors"
)

func main() {
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
		defer logFile.Close()
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
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if !docker.IsDockerAvailable() {
		slog.Error("docker.init.failed",
			"hint", "Docker daemon is not running. Start Docker Desktop and try again.")
		os.Exit(1)
	}

	jwtService, err := auth.New()
	if err != nil {
		slog.Error("jwt.init.failed", "error", err.Error(),
			"hint", fmt.Sprintf("Run: aws sso login --profile %s (or set AWS_PROFILE to use a different profile)", awsProfile()))
		os.Exit(1)
	}

	docker.NewManager().Reconcile(db)

	authType := getEnv("AUTH_TYPE", "none")
	ssoHost := getEnv("SSO_HOST", "sso.dev-godaddy.com")
	ssoMW, err := auth.NewSSOMiddleware(authType, ssoHost)
	if err != nil {
		slog.Error("sso.init.failed", "error", err)
		os.Exit(1)
	}

	router := api.NewRouter(db, jwtService, ssoMW)

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	}).Handler(router)

	server := &http.Server{
		Addr:    ":" + port,
		Handler: handler,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		slog.Info("shutting down")
		server.Close()
	}()

	slog.Info("local-control-plane starting", "port", port, "db", dbPath, "auth_type", authType)
	fmt.Printf("\n  Local Control Plane running at http://localhost:%s\n\n", port)

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
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
			os.Setenv(key, val)
		}
	}
}

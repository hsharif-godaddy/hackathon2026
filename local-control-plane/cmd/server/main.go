package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/airo-ai-builder/local-control-plane/internal/api"
	"github.com/airo-ai-builder/local-control-plane/internal/auth"
	"github.com/airo-ai-builder/local-control-plane/internal/docker"
	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/rs/cors"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "4100"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "local-control-plane.db"
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
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

	router := api.NewRouter(db, jwtService)

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

	slog.Info("local-control-plane starting", "port", port, "db", dbPath)
	fmt.Printf("\n  Local Control Plane running at http://localhost:%s\n\n", port)

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}

func awsProfile() string {
	if p := os.Getenv("AWS_PROFILE"); p != "" {
		return p
	}
	return "airobuild-dev-private-sso"
}

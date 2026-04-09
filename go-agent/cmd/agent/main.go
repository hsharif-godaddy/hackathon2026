package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/agent"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/anthropic"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/config"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/eventbus"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/prompt"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/session"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/store"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/supervisor"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool/fileops"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool/grep"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/toolbridge"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/transport"
)

// Version is set at build time via -ldflags.
var Version = "dev"

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config.load.failure", "error", err)
		os.Exit(1)
	}

	logger := setupLogger(cfg.LogLevel)
	logger.Info("agent.starting", "version", Version)

	db, err := store.Open(cfg.DatabasePath)
	if err != nil {
		logger.Error("database.open.failure", "error", err)
		os.Exit(1)
	}
	defer func() { _ = db.Close() }()

	// Core infrastructure.
	bus := eventbus.New()
	runStore := run.NewStore()

	// Tool registry.
	toolReg := tool.NewRegistry()
	svFactory := supervisor.NewClientFactory()
	registerNativeTools(toolReg, svFactory)

	// Start the TS bridge process and discover its tools.
	bridge, err := startBridge(cfg, logger)
	if err != nil {
		logger.Warn("bridge.start.skipped", "error", err)
	} else {
		defer func() { _ = bridge.Stop() }()
		registerBridgeTools(toolReg, bridge.SocketPath(), logger)
	}

	// Prompt loader. Resolves relative to the binary's directory so it
	// works regardless of the process working directory.
	promptsDir := resolvePromptsDir()
	promptLoader := prompt.NewLoader(os.DirFS(promptsDir))

	// LLM client.
	llmClient := anthropic.NewAdapter(anthropic.NewClient(cfg.AnthropicAPIKey), logger)

	// Run engine.
	engine := run.NewEngine(bus, runStore, toolReg, promptLoader, agent.AllAgents())

	// Session manager.
	convRepo := store.NewConversationRepo(db)
	msgRepo := store.NewMessageRepo(db)
	sessMgr := session.NewManager(engine, runStore, convRepo, msgRepo, llmClient)

	// WebSocket transport.
	authFunc := func(_ *http.Request) (string, error) {
		// Phase 1: no auth (single-tenant local dev).
		// Production will use JWT validation via dev-supervisor proxy.
		return "default-app", nil
	}
	ws := transport.NewServer(sessMgr, runStore, authFunc, logger)

	// HTTP server.
	mux := http.NewServeMux()
	mux.Handle("/ws", ws.Handler())
	mux.HandleFunc("/health", healthHandler(db))

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Graceful shutdown.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		sig := <-sigCh
		logger.Info("agent.shutdown.begin", "signal", sig.String())

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		bus.Close()
		_ = server.Shutdown(ctx)
	}()

	logger.Info("agent.listening", "port", cfg.Port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server.failure", "error", err)
	}

	logger.Info("agent.shutdown.complete")
}

func setupLogger(level string) *slog.Logger {
	var slogLevel slog.Level
	switch strings.ToLower(level) {
	case "debug":
		slogLevel = slog.LevelDebug
	case "warn":
		slogLevel = slog.LevelWarn
	case "error":
		slogLevel = slog.LevelError
	default:
		slogLevel = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slogLevel,
	}))
}

// resolvePromptsDir returns the path to the prompts directory, resolving
// relative to the binary's directory so it works regardless of CWD.
func resolvePromptsDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "prompts"
	}
	return filepath.Join(filepath.Dir(exe), "prompts")
}

func registerNativeTools(reg *tool.Registry, factory *supervisor.ClientFactory) {
	reg.Register(fileops.NewReadFile(factory))
	reg.Register(fileops.NewTextEditor(factory))
	reg.Register(fileops.NewDirectoryListing(factory))
	reg.Register(grep.NewSearch(factory))
	// TODO: Register terminal.NewCommand(factory) once supervisor is available in prod.
}

func registerBridgeTools(reg *tool.Registry, socketPath string, logger *slog.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tools, err := toolbridge.DiscoverTools(ctx, socketPath)
	if err != nil {
		logger.Warn("bridge.discovery.skipped", "error", err)
		return
	}

	for _, bt := range tools {
		reg.Register(bt)
	}
	logger.Info("bridge.discovery.success", "toolCount", len(tools))
}

func startBridge(cfg *config.Config, logger *slog.Logger) (*toolbridge.BridgeProcess, error) {
	// Resolve DB_PATH to absolute so the bridge (which runs from BridgeDir)
	// accesses the same SQLite file as the Go agent.
	dbPath, err := filepath.Abs(cfg.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("resolving database path: %w", err)
	}

	// Resolve BridgeDir to absolute for the same reason — the default is
	// relative ("../ts-bridge") and only works from go-agent/.
	bridgeDir, err := filepath.Abs(cfg.BridgeDir)
	if err != nil {
		return nil, fmt.Errorf("resolving bridge dir: %w", err)
	}

	return toolbridge.Start(context.Background(), toolbridge.BridgeProcessConfig{
		BridgeDir:    bridgeDir,
		SocketPath:   cfg.BridgeSocketPath,
		Env:          []string{"DB_PATH=" + dbPath},
		StartTimeout: 30 * time.Second,
		Logger:       logger,
	})
}

func healthHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := "ok"
		if err := db.PingContext(r.Context()); err != nil {
			status = "degraded"
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":  status,
			"version": Version,
		})
	}
}

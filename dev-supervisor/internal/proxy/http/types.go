package httpproxy

import (
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

const (
	protoHTTP  = "http"
	protoHTTPS = "https"
)

func determineForwardedProto(req *http.Request) string {
	if raw := strings.TrimSpace(req.Header.Get("X-Forwarded-Proto")); raw != "" {
		normalized := strings.ToLower(raw)
		if normalized == protoHTTP || normalized == protoHTTPS {
			return normalized
		}

		slog.Warn("http.proxy.invalid_forwarded_proto",
			"value", raw,
			"remote_addr", req.RemoteAddr,
		)
	}

	if req.TLS != nil {
		return protoHTTPS
	}

	return protoHTTP
}

// getClientIP extracts the real client IP from CF-Connecting-IP header.
// Returns empty string if header is not present (direct connection, no Cloudflare).
func getClientIP(req *http.Request) string {
	return strings.TrimSpace(req.Header.Get("Cf-Connecting-Ip"))
}

// getSrcIPAndPort splits RemoteAddr into IP and port components.
// RemoteAddr format is typically "ip:port" or "[ipv6]:port".
func getSrcIPAndPort(remoteAddr string) (string, string) {
	host, port, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		// If split fails, return the whole address as IP with empty port.
		return remoteAddr, ""
	}
	return host, port
}

// getRayID extracts the CF-Ray header for request tracing.
// Returns empty string if header is not present.
func getRayID(req *http.Request) string {
	return strings.TrimSpace(req.Header.Get("Cf-Ray"))
}

// getShareToken extracts the share token from query param or cookie.
// Checks query param first (airoShareToken), then cookie (airo_share_token).
// Returns empty string if not present.
func getShareToken(req *http.Request) string {
	// Check query param first
	if token := req.URL.Query().Get("airoShareToken"); token != "" {
		return strings.TrimSpace(token)
	}

	// Check cookie second
	if cookie, err := req.Cookie("airo_share_token"); err == nil && cookie.Value != "" {
		return strings.TrimSpace(cookie.Value)
	}

	return ""
}

// Config defines configuration for the HTTP proxy server.
type Config struct {
	Enabled        bool          // Enable HTTP proxy mode
	ListenPort     int           // External HTTPS port for proxy
	TargetHost     string        // Backend host (typically localhost)
	TargetPort     int           // Backend port (app internal port, typically 8080)
	TLSCertPath    string        // Path to TLS certificate
	TLSKeyPath     string        // Path to TLS private key
	MaxRetries     int           // Maximum number of retries for connection errors (default: 5)
	InitialBackoff time.Duration // Initial backoff duration (default: 100ms)
	MaxBackoff     time.Duration // Maximum backoff duration (default: 2s)

	APIPrefix      string   // API route prefix (default: "/api")
	AllowedOrigins []string // CORS allowed origins (whitelist)

	// JWT authentication configuration
	// Auth failure handling uses hybrid mode: redirects browsers to builder, returns 401 for APIs
	JWTEnabled        bool     // Enable JWT authentication (default: false)
	JWKSUrl           string   // JWKS endpoint URL
	JWKSSkipTLSVerify bool     // Skip TLS certificate verification (local dev only)
	SiteID            string   // Site ID for smart redirects (from SITE_ID env var)
	JWTExcludedPaths  []string // Paths to exclude from JWT validation

	// Share token configuration (for public preview links)
	EnableShareTokens bool   // Enable share token validation (default: false)
	AgentsBaseURL     string // Base URL for agents API (for share token validation)

	// StatusPage, when non-nil, serves a fallback HTML page in place of the
	// reverse proxy whenever it reports Active() (suspended site or no
	// publish archive present). Nil disables the fallback.
	StatusPage *StatusPage
}

// Status represents the current status of the HTTP proxy.
type Status struct {
	Enabled    bool   `json:"enabled"`
	Running    bool   `json:"running"`
	ListenAddr string `json:"listen_addr,omitempty"`
	TargetURL  string `json:"target_url,omitempty"`
	Uptime     string `json:"uptime,omitempty"`
}

// ProxyHealthResponse represents the health check response.
type ProxyHealthResponse struct {
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

// CanaryCheckResponse represents the response from the canary checks endpoint.
type CanaryCheckResponse struct {
	Status string                  `json:"status"`
	Checks map[string]*CheckResult `json:"checks,omitempty"`
}

// CheckResult represents the result of an individual health check.
type CheckResult struct {
	Status  string `json:"status"`            // "healthy" or "unhealthy"
	Latency string `json:"latency,omitempty"` // e.g., "15ms"
	Error   string `json:"error,omitempty"`
}

// ProcessState is a minimal state representation for start-on-request tracking.
type ProcessState string

const (
	ProcessStateStopped  ProcessState = "stopped"
	ProcessStateStarting ProcessState = "starting"
	ProcessStateRunning  ProcessState = "running"
	ProcessStateStopping ProcessState = "stopping"
	ProcessStateError    ProcessState = "error"
)

// ProcessStatus is a minimal status payload needed by the proxy.
type ProcessStatus struct {
	PID   int
	State ProcessState
	Error string
}

// ProcessController is the minimal surface the proxy needs for start-on-request handling.
type ProcessController interface {
	middleware.WebSocketTracker
	GetStartRequest() *validation.ProcessStartRequest
	Start(validation.ProcessStartRequest) error
	GetStatus() ProcessStatus
	UpdateActivity()
	IsStartOnRequestEnabled() bool
	TrackRequest() bool // Returns false if request should be rejected (idle stopping)
	UntrackRequest()
	EnableStartOnRequest(idleTimeout, checkInterval time.Duration)
	WasHealthyBeforeIdle() bool
	GetStateChangeChan() <-chan struct{}
	// Deferred setup methods (mode-based conditional startup)
	HasDeferredSetup() bool
	ExecuteDeferredSetup() error
}

// Sentinel errors for start-on-request handling.
var (
	ErrAlreadyStarting = errors.New("process is already starting")
	ErrAlreadyRunning  = errors.New("process is already running")
)

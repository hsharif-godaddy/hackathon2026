package httpproxy

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// isWebSocketUpgrade checks if a request is attempting a WebSocket upgrade.
func isWebSocketUpgrade(req *http.Request) bool {
	connHeader := strings.ToLower(req.Header.Get("Connection"))
	upgradeHeader := strings.ToLower(req.Header.Get("Upgrade"))
	return strings.Contains(connHeader, "upgrade") && upgradeHeader == "websocket"
}

func (p *HTTPProxy) newReverseProxy(targetURL *url.URL, transport http.RoundTripper) *httputil.ReverseProxy {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			// Set the target URL
			r.SetURL(targetURL)

			// Preserve original Host header (required for Vite HMR and backend routing)
			// This proxy only accepts requests from trusted sources (internal network),
			// so preserving the original Host header is safe.
			r.Out.Host = r.In.Host
			r.Out.Header.Set("Host", r.In.Host)

			// Check if this is a WebSocket upgrade request (check once and reuse)
			isWebSocket := isWebSocketUpgrade(r.In)

			// Preserve WebSocket upgrade headers (critical for Vite HMR)
			// The Connection and Upgrade headers must be explicitly copied for WebSocket support
			if isWebSocket {
				// Copy WebSocket-specific headers using a loop to reduce duplication
				wsHeadersToCopy := []string{
					"Connection",
					"Upgrade",
					"Sec-WebSocket-Key",
					"Sec-WebSocket-Version",
					"Sec-WebSocket-Extensions",
					"Sec-WebSocket-Protocol",
				}
				for _, headerName := range wsHeadersToCopy {
					if value := r.In.Header.Get(headerName); value != "" {
						r.Out.Header.Set(headerName, value)
					}
				}

				slog.Debug("proxying WebSocket upgrade request",
					"method", r.In.Method,
					"path", r.In.URL.Path,
					"host", r.In.Host,
					"target", targetURL.String())
			}

			// Copy X-Forwarded-For unchanged from incoming request (if present)
			// By default, ReverseProxy removes X-Forwarded-* headers, so we explicitly copy it
			if xff := r.In.Header.Get("X-Forwarded-For"); xff != "" {
				r.Out.Header["X-Forwarded-For"] = []string{xff}
			}

			// Set X-Forwarded-Proto based on upstream input or actual scheme
			r.Out.Header.Set("X-Forwarded-Proto", determineForwardedProto(r.In))

			// Note: X-Forwarded-Host is not set (Host header is already correct)
			// Note: X-Real-IP is not set (only accessible by trusted sources)

			if !isWebSocket {
				clientIP := getClientIP(r.In)
				srcIP, srcPort := getSrcIPAndPort(r.In.RemoteAddr)
				rayID := getRayID(r.In)

				logAttrs := []any{
					"method", r.In.Method,
					"path", r.In.URL.Path,
					"host", r.In.Host,
					"target", targetURL.String(),
					"src_ip", srcIP,
					"src_port", srcPort,
				}

				if clientIP != "" {
					logAttrs = append(logAttrs, "client_ip", clientIP)
				}

				if rayID != "" {
					logAttrs = append(logAttrs, "ray_id", rayID)
				}

				slog.Debug("proxying request", logAttrs...)
			}
		},
		// ModifyResponse removes CORS headers from backend responses to prevent duplication
		// The rs/cors middleware (outer layer) will add the correct CORS headers
		// This handles cases where backends (like Vite) set their own CORS headers
		ModifyResponse: func(resp *http.Response) error {
			// Remove all CORS headers that backends might set
			// This prevents duplicate CORS headers when both proxy and backend set them
			resp.Header.Del("Access-Control-Allow-Origin")
			resp.Header.Del("Access-Control-Allow-Credentials")
			resp.Header.Del("Access-Control-Allow-Methods")
			resp.Header.Del("Access-Control-Allow-Headers")
			resp.Header.Del("Access-Control-Max-Age")
			resp.Header.Del("Access-Control-Expose-Headers")
			return nil
		},
		Transport: transport,
		// FlushInterval enables streaming responses and is required for WebSockets
		// and Server-Sent Events (SSE). Without this, responses are buffered.
		FlushInterval: -1, // Flush immediately (required for WebSockets)
		// Note: CORS headers are set by CORS middleware (outermost layer)
	}

	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		// Determine appropriate status code based on error type
		statusCode := http.StatusBadGateway

		// Check if this is a connection error (backend not ready)
		if isRetryableError(err) {
			// 503 Service Unavailable - backend is starting up or temporarily unavailable
			statusCode = http.StatusServiceUnavailable

			slog.Warn("backend not ready after retries",
				"error", err,
				"method", r.Method,
				"path", r.URL.Path,
				"remote_addr", r.RemoteAddr)
		} else {
			// 502 Bad Gateway - actual proxy error
			slog.Error("proxy error",
				"error", err,
				"method", r.Method,
				"path", r.URL.Path,
				"remote_addr", r.RemoteAddr)
		}

		// CORS headers are set by CORS middleware (outermost layer)
		// Return appropriate status code with generic error message to avoid information disclosure
		// Use http.Error to avoid XSS vulnerability from fmt.Fprintf
		// Detailed error information is already logged above
		http.Error(w, http.StatusText(statusCode), statusCode)
	}

	return proxy
}

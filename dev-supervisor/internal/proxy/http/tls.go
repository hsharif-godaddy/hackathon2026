package httpproxy

import (
	"crypto/tls"
	"fmt"
	"log/slog"
)

// loadTLSConfig loads and configures TLS settings.
func (p *HTTPProxy) loadTLSConfig() (*tls.Config, error) {
	// Load certificate and key
	cert, err := tls.LoadX509KeyPair(p.config.TLSCertPath, p.config.TLSKeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load certificate pair: %w", err)
	}

	// Create TLS configuration
	// Only include cipher suites with forward secrecy (ECDHE)
	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
		},
		PreferServerCipherSuites: true,
	}

	slog.Info("TLS configuration loaded",
		"cert_path", p.config.TLSCertPath,
		"min_tls_version", "1.2")

	return tlsConfig, nil
}

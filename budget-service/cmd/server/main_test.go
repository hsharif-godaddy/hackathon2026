package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/config"
)

func TestBootstrapLogLevel_Default(t *testing.T) {
	t.Setenv("LOG_LEVEL", "")

	if got := bootstrapLogLevel(); got != "info" {
		t.Errorf("bootstrapLogLevel() = %q, want %q", got, "info")
	}
}

func TestBootstrapLogLevel_SetValue(t *testing.T) {
	t.Setenv("LOG_LEVEL", "debug")

	if got := bootstrapLogLevel(); got != "debug" {
		t.Errorf("bootstrapLogLevel() = %q, want %q", got, "debug")
	}
}

func TestBootstrapLogLevel_Whitespace(t *testing.T) {
	t.Setenv("LOG_LEVEL", "  warn  ")

	if got := bootstrapLogLevel(); got != "warn" {
		t.Errorf("bootstrapLogLevel() = %q, want %q", got, "warn")
	}
}

func TestBootstrapLogLevel_EmptyAfterTrim(t *testing.T) {
	t.Setenv("LOG_LEVEL", "   ")

	if got := bootstrapLogLevel(); got != "info" {
		t.Errorf("bootstrapLogLevel() = %q, want %q", got, "info")
	}
}

func TestSetupLogger_DoesNotPanic(t *testing.T) {
	levels := []string{"debug", "info", "warn", "warning", "error", "", "unknown"}
	for _, level := range levels {
		t.Run(level, func(t *testing.T) {
			setupLogger(level)
		})
	}
}

func TestDbHostname(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"postgres URL", "postgres://user:pass@myhost.example.com:5432/db", "myhost.example.com"},
		{"empty string", "", "unknown"},
		{"invalid URL", "://bad", "unknown"},
		{"no host", "postgres:///db", "unknown"},
		{"host with port", "postgres://localhost:5432/db", "localhost"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := dbHostname(tt.url); got != tt.want {
				t.Errorf("dbHostname(%q) = %q, want %q", tt.url, got, tt.want)
			}
		})
	}
}

func TestResolveMigrateURL(t *testing.T) {
	tests := []struct {
		name       string
		migrateURL string
		dbURL      string
		want       string
	}{
		{"uses MigrateDatabaseURL when set", "postgres://migrate-host/db", "postgres://pool-host/db", "postgres://migrate-host/db"},
		{"falls back to DatabaseURL", "", "postgres://pool-host/db", "postgres://pool-host/db"},
		{"both empty", "", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &config.Config{
				MigrateDatabaseURL: tt.migrateURL,
				DatabaseURL:        tt.dbURL,
			}
			if got := resolveMigrateURL(cfg); got != tt.want {
				t.Errorf("resolveMigrateURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBuildHTTPServer_PlainHTTP(t *testing.T) {
	cfg := &config.Config{
		Addr:             ":9090",
		HTTPReadTimeout:  5 * time.Second,
		HTTPWriteTimeout: 10 * time.Second,
		HTTPIdleTimeout:  60 * time.Second,
	}
	handler := http.NewServeMux()

	srv, err := buildHTTPServer(cfg, handler)
	if err != nil {
		t.Fatalf("buildHTTPServer() error = %v", err)
	}
	if srv.Addr != ":9090" {
		t.Errorf("Addr = %q, want %q", srv.Addr, ":9090")
	}
	if srv.ReadTimeout != 5*time.Second {
		t.Errorf("ReadTimeout = %v, want %v", srv.ReadTimeout, 5*time.Second)
	}
	if srv.WriteTimeout != 10*time.Second {
		t.Errorf("WriteTimeout = %v, want %v", srv.WriteTimeout, 10*time.Second)
	}
	if srv.IdleTimeout != 60*time.Second {
		t.Errorf("IdleTimeout = %v, want %v", srv.IdleTimeout, 60*time.Second)
	}
	if srv.TLSConfig != nil {
		t.Error("TLSConfig should be nil for plain HTTP")
	}
}

func TestBuildHTTPServer_TLS(t *testing.T) {
	certPath, keyPath := generateTestCert(t)

	cfg := &config.Config{
		Addr:             ":9443",
		HTTPReadTimeout:  5 * time.Second,
		HTTPWriteTimeout: 10 * time.Second,
		HTTPIdleTimeout:  60 * time.Second,
		TLSCertPath:      certPath,
		TLSKeyPath:       keyPath,
	}

	srv, err := buildHTTPServer(cfg, http.NewServeMux())
	if err != nil {
		t.Fatalf("buildHTTPServer() error = %v", err)
	}
	if srv.TLSConfig == nil {
		t.Fatal("TLSConfig should be set for TLS")
	}
	if srv.TLSConfig.MinVersion != tls.VersionTLS13 {
		t.Errorf("MinVersion = %d, want %d", srv.TLSConfig.MinVersion, tls.VersionTLS13)
	}
	if len(srv.TLSConfig.Certificates) != 1 {
		t.Errorf("Certificates length = %d, want 1", len(srv.TLSConfig.Certificates))
	}
}

func TestBuildHTTPServer_TLS_BadPaths(t *testing.T) {
	cfg := &config.Config{
		Addr:        ":9443",
		TLSCertPath: "/nonexistent/cert.pem",
		TLSKeyPath:  "/nonexistent/key.pem",
	}

	_, err := buildHTTPServer(cfg, http.NewServeMux())
	if err == nil {
		t.Fatal("buildHTTPServer() should return error for invalid cert paths")
	}
}

func TestListenAndServe_PlainHTTP(t *testing.T) {
	srv := &http.Server{
		Addr:    "127.0.0.1:0",
		Handler: http.NewServeMux(),
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	srv.Addr = ln.Addr().String()
	ln.Close()

	errCh := make(chan error, 1)
	go func() {
		errCh <- listenAndServe(srv)
	}()

	time.Sleep(50 * time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown error: %v", err)
	}

	if err := <-errCh; err != nil {
		t.Errorf("listenAndServe() returned unexpected error: %v", err)
	}
}

func TestListenAndServe_TLS(t *testing.T) {
	certPath, keyPath := generateTestCert(t)
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		t.Fatalf("failed to load test cert: %v", err)
	}

	srv := &http.Server{
		Addr:    "127.0.0.1:0",
		Handler: http.NewServeMux(),
		TLSConfig: &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS13,
		},
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- listenAndServe(srv)
	}()

	time.Sleep(50 * time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown error: %v", err)
	}

	if err := <-errCh; err != nil {
		t.Errorf("listenAndServe() returned unexpected error: %v", err)
	}
}

func TestShutdownServer_NoWorker(t *testing.T) {
	srv := &http.Server{
		Addr:    "127.0.0.1:0",
		Handler: http.NewServeMux(),
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	go srv.Serve(ln)

	err = shutdownServer(srv, nil, nil, 5*time.Second)
	if err != nil {
		t.Errorf("shutdownServer() error = %v", err)
	}
}

func TestShutdownServer_WithWorker(t *testing.T) {
	srv := &http.Server{
		Addr:    "127.0.0.1:0",
		Handler: http.NewServeMux(),
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	go srv.Serve(ln)

	var wg sync.WaitGroup
	ctx, cancel := context.WithCancel(context.Background())
	workerDone := make(chan struct{})

	wg.Add(1)
	go func() {
		defer wg.Done()
		<-ctx.Done()
		close(workerDone)
	}()

	err = shutdownServer(srv, cancel, &wg, 5*time.Second)
	if err != nil {
		t.Errorf("shutdownServer() error = %v", err)
	}

	select {
	case <-workerDone:
	default:
		t.Error("worker goroutine was not cancelled")
	}
}

func TestOpenDatabase_InvalidDriver(t *testing.T) {
	cfg := &config.Config{
		DatabaseURL:       "postgres://localhost:5432/nonexistent_test_db_xyzzy",
		DBMaxOpenConns:    5,
		DBMaxIdleConns:    2,
		DBConnMaxLifetime: 30 * time.Minute,
	}

	db, err := openDatabase(cfg)
	if err != nil {
		t.Fatalf("openDatabase() should not error on Open (only on Ping): %v", err)
	}
	defer db.Close()

	if db.Stats().MaxOpenConnections != 5 {
		t.Errorf("MaxOpenConnections = %d, want 5", db.Stats().MaxOpenConnections)
	}
}

func generateTestCert(t *testing.T) (certPath string, keyPath string) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{Organization: []string{"Test"}},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(time.Hour),
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("failed to create certificate: %v", err)
	}

	dir := t.TempDir()
	certPath = filepath.Join(dir, "cert.pem")
	keyPath = filepath.Join(dir, "key.pem")

	certOut, err := os.Create(certPath)
	if err != nil {
		t.Fatalf("failed to create cert file: %v", err)
	}
	pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	certOut.Close()

	keyBytes, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("failed to marshal key: %v", err)
	}
	keyOut, err := os.Create(keyPath)
	if err != nil {
		t.Fatalf("failed to create key file: %v", err)
	}
	pem.Encode(keyOut, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes})
	keyOut.Close()

	return certPath, keyPath
}

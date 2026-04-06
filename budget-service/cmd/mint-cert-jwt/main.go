// Command mint-cert-jwt prints a GoDaddy Cert-class JWT (raw string, no "Bearer " prefix) by mTLS
// POST https://SSO_HOST/v1/secure/api/token with realm=cert.
//
// Set CERT_PEM_PATH and CERT_KEY_PATH (e.g. under ./.certs/ — that dir is gitignored). SSO_HOST must match budget-service.
//
//	curl -H "Authorization: Bearer $(go run ./cmd/mint-cert-jwt)" http://localhost:8080/api/v1/auth-check
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type payloadResponse struct {
	Type    string `json:"type"`
	ID      string `json:"id"`
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

func main() {
	_ = godotenv.Load()

	ssoHost := os.Getenv("SSO_HOST")
	if ssoHost == "" {
		fmt.Fprintln(os.Stderr, "mint-cert-jwt: set SSO_HOST (e.g. sso.dev-godaddy.com), same as budget-service")
		os.Exit(2)
	}
	certPath := os.Getenv("CERT_PEM_PATH")
	keyPath := os.Getenv("CERT_KEY_PATH")
	if certPath == "" || keyPath == "" {
		fmt.Fprintln(os.Stderr, "mint-cert-jwt: set CERT_PEM_PATH and CERT_KEY_PATH (e.g. ./.certs/cert.pem and ./.certs/key.pem)")
		os.Exit(2)
	}

	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mint-cert-jwt: read cert: %v\n", err)
		os.Exit(1)
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mint-cert-jwt: read key: %v\n", err)
		os.Exit(1)
	}

	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mint-cert-jwt: X509KeyPair: %v\n", err)
		os.Exit(1)
	}

	client := &http.Client{
		Timeout: 45 * time.Second,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			TLSClientConfig: &tls.Config{
				Certificates:  []tls.Certificate{pair},
				MinVersion:    tls.VersionTLS12,
				Renegotiation: tls.RenegotiateOnceAsClient,
			},
		},
	}

	ctx := context.Background()
	url := fmt.Sprintf("https://%s/v1/secure/api/token", ssoHost)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader("realm=cert"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "mint-cert-jwt: request: %v\n", err)
		os.Exit(1)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mint-cert-jwt: %s: %v\n", url, err)
		os.Exit(1)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mint-cert-jwt: read body: %v\n", err)
		os.Exit(1)
	}

	var res payloadResponse
	if err := json.Unmarshal(body, &res); err != nil {
		fmt.Fprintf(os.Stderr, "mint-cert-jwt: JSON: %v (body: %s)\n", err, string(body))
		os.Exit(1)
	}
	if res.Data == "" {
		fmt.Fprintf(os.Stderr, "mint-cert-jwt: empty token (HTTP %s): %s\n", resp.Status, string(body))
		os.Exit(1)
	}

	fmt.Println(res.Data)
}

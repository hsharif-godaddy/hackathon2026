package auth

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
)

func generateTestKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	return key
}

func rsaKeyToPEM(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func TestParsePrivateKeyValid(t *testing.T) {
	key := generateTestKey(t)
	pemData := rsaKeyToPEM(t, key)

	parsed, err := parsePrivateKey(pemData)
	if err != nil {
		t.Fatalf("parsePrivateKey: %v", err)
	}
	if parsed == nil {
		t.Fatal("expected non-nil key")
	}
}

func TestParsePrivateKeyEscapedNewlines(t *testing.T) {
	key := generateTestKey(t)
	pemData := rsaKeyToPEM(t, key)

	// Replace real newlines with literal \n (as stored in JSON)
	escaped := strings.ReplaceAll(pemData, "\n", `\n`)

	parsed, err := parsePrivateKey(escaped)
	if err != nil {
		t.Fatalf("parsePrivateKey with escaped newlines: %v", err)
	}
	if parsed == nil {
		t.Fatal("expected non-nil key")
	}
}

func TestParsePrivateKeyInvalidPEM(t *testing.T) {
	_, err := parsePrivateKey("not-a-pem-block")
	if err == nil {
		t.Fatal("expected error for invalid PEM")
	}
	if !strings.Contains(err.Error(), "decode PEM") {
		t.Fatalf("expected 'decode PEM' error, got: %v", err)
	}
}

func TestParsePrivateKeyNonRSA(t *testing.T) {
	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate EC key: %v", err)
	}

	der, err := x509.MarshalPKCS8PrivateKey(ecKey)
	if err != nil {
		t.Fatalf("marshal EC key: %v", err)
	}
	pemData := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))

	_, err = parsePrivateKey(pemData)
	if err == nil {
		t.Fatal("expected error for non-RSA key")
	}
	if !strings.Contains(err.Error(), "not RSA") {
		t.Fatalf("expected 'not RSA' error, got: %v", err)
	}
}

func TestMint(t *testing.T) {
	key := generateTestKey(t)
	svc := &JWTService{privateKey: key, kid: "test-kid-001"}

	token, err := svc.Mint("site-abc")
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("expected 3-part JWT, got %d parts", len(parts))
	}

	// Decode header
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		t.Fatalf("decode header: %v", err)
	}

	var header map[string]string
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		t.Fatalf("unmarshal header: %v", err)
	}

	if header["alg"] != "RS256" {
		t.Errorf("expected alg RS256, got %s", header["alg"])
	}
	if header["kid"] != "test-kid-001" {
		t.Errorf("expected kid test-kid-001, got %s", header["kid"])
	}
	if header["typ"] != "JWT" {
		t.Errorf("expected typ JWT, got %s", header["typ"])
	}

	// Decode claims
	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode claims: %v", err)
	}

	var claims map[string]any
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		t.Fatalf("unmarshal claims: %v", err)
	}

	if claims["iss"] != "airo-app" {
		t.Errorf("expected iss airo-app, got %v", claims["iss"])
	}
	if claims["aud"] != "agents-service" {
		t.Errorf("expected aud agents-service, got %v", claims["aud"])
	}
	if claims["siteId"] != "site-abc" {
		t.Errorf("expected siteId site-abc, got %v", claims["siteId"])
	}
	if claims["canDownload"] != true {
		t.Errorf("expected canDownload true, got %v", claims["canDownload"])
	}
	if claims["authType"] != "basic" {
		t.Errorf("expected authType basic, got %v", claims["authType"])
	}

	// Verify exp > iat
	iat, _ := claims["iat"].(float64)
	exp, _ := claims["exp"].(float64)
	if exp <= iat {
		t.Error("expected exp > iat")
	}
	if exp-iat != 43200 {
		t.Errorf("expected 12h expiration (43200s), got %v", exp-iat)
	}

	// Verify signature with public key
	message := parts[0] + "." + parts[1]
	hash := sha256.Sum256([]byte(message))

	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}

	err = rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, hash[:], sigBytes)
	if err != nil {
		t.Fatalf("signature verification failed: %v", err)
	}
}

func TestMintDifferentSiteIds(t *testing.T) {
	key := generateTestKey(t)
	svc := &JWTService{privateKey: key, kid: "test-kid"}

	t1, _ := svc.Mint("site-1")
	t2, _ := svc.Mint("site-2")

	if t1 == t2 {
		t.Error("expected different tokens for different siteIds")
	}

	// Verify different claims
	parts1 := strings.Split(t1, ".")
	parts2 := strings.Split(t2, ".")

	claims1JSON, _ := base64.RawURLEncoding.DecodeString(parts1[1])
	claims2JSON, _ := base64.RawURLEncoding.DecodeString(parts2[1])

	var c1, c2 map[string]any
	json.Unmarshal(claims1JSON, &c1)
	json.Unmarshal(claims2JSON, &c2)

	if c1["siteId"] == c2["siteId"] {
		t.Error("expected different siteId claims")
	}
}

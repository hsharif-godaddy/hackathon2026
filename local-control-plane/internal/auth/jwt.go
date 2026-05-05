package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

const (
	issuer   = "airo-app"
	audience = "agents-service"
)

type keyMetadata struct {
	KeyID      string `json:"keyId"`
	PrivateKey string `json:"privateKey"`
	PublicKey  string `json:"publicKey"`
	Status     string `json:"status"`
}

type secretValue struct {
	Keys []keyMetadata `json:"keys"`
}

type JWTService struct {
	privateKey *rsa.PrivateKey
	kid        string
}

// New creates a JWTService by fetching keys from AWS Secrets Manager,
// mirroring how app/ does it.
func New() (*JWTService, error) {
	secretName := os.Getenv("JWT_SECRETS_NAME")
	if secretName == "" {
		secretName = "dev-airo-jwt-keys"
	}

	region := os.Getenv("AWS_REGION")
	if region == "" {
		region = "us-west-2"
	}

	profile := os.Getenv("AWS_PROFILE")
	if profile == "" {
		profile = "airobuild-dev-private-sso"
	}

	cfg, err := config.LoadDefaultConfig(
		context.Background(),
		config.WithRegion(region),
		config.WithSharedConfigProfile(profile),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	client := secretsmanager.NewFromConfig(cfg)
	result, err := client.GetSecretValue(context.Background(), &secretsmanager.GetSecretValueInput{
		SecretId: &secretName,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch secret %q: %w", secretName, err)
	}

	if result.SecretString == nil {
		return nil, fmt.Errorf("secret %q has no string value", secretName)
	}

	var secret secretValue
	if err := json.Unmarshal([]byte(*result.SecretString), &secret); err != nil {
		return nil, fmt.Errorf("failed to parse secret JSON: %w", err)
	}

	var active *keyMetadata
	for i := range secret.Keys {
		if secret.Keys[i].Status == "active" {
			active = &secret.Keys[i]
			break
		}
	}
	if active == nil {
		return nil, fmt.Errorf("no active key found in secret %q", secretName)
	}

	rsaKey, err := parsePrivateKey(active.PrivateKey)
	if err != nil {
		return nil, err
	}

	slog.Info("jwt.loaded", "kid", active.KeyID, "secret", secretName)
	return &JWTService{privateKey: rsaKey, kid: active.KeyID}, nil
}

// Mint creates a signed JWT for the given siteId.
func (j *JWTService) Mint(siteId string) (string, error) {
	now := time.Now().Unix()

	header := map[string]string{
		"typ": "JWT",
		"alg": "RS256",
		"kid": j.kid,
	}

	claims := map[string]any{
		"iss":               issuer,
		"aud":               audience,
		"exp":               now + 43200,
		"iat":               now,
		"siteId":            siteId,
		"canDownload":       true,
		"canPublish":        true,
		"canPurchaseDomain": false,
		"authType":          "basic",
		"isE2S":             false,
	}

	headerJSON, _ := json.Marshal(header)
	claimsJSON, _ := json.Marshal(claims)

	headerB64 := base64.RawURLEncoding.EncodeToString(headerJSON)
	claimsB64 := base64.RawURLEncoding.EncodeToString(claimsJSON)

	message := headerB64 + "." + claimsB64

	hash := sha256.Sum256([]byte(message))
	sig, err := rsa.SignPKCS1v15(rand.Reader, j.privateKey, crypto.SHA256, hash[:])
	if err != nil {
		return "", fmt.Errorf("failed to sign JWT: %w", err)
	}

	return message + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

func parsePrivateKey(pemData string) (*rsa.PrivateKey, error) {
	pemData = strings.ReplaceAll(pemData, `\n`, "\n")

	block, _ := pem.Decode([]byte(pemData))
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block from private key")
	}

	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("private key is not RSA")
	}

	return rsaKey, nil
}

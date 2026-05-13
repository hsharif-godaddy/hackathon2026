package kmspubkey

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/kms/types"
)

// expectedRSABits is the modulus size we require. CDK provisions
// RSA_2048 in airo-stripe-service-stack.ts; widening to RSA_4096 is a
// schema change that should land alongside CDK + integration-doc
// updates if it ever happens.
const expectedRSABits = 2048

// fetchAndValidate calls kms:GetPublicKey on the given keyID, runs
// every documented validation, and PEM-encodes the result via PKIX.
//
// Returns the PEM string that internal/stripeapi.CreateAPIKey can put
// directly into PEMKey.Data.
func fetchAndValidate(ctx context.Context, kmsClient keyFetcher, keyID string) (string, error) {
	out, err := kmsClient.GetPublicKey(ctx, &kms.GetPublicKeyInput{
		KeyId: aws.String(keyID),
	})
	if err != nil {
		return "", fmt.Errorf("kmspubkey: GetPublicKey on %q: %w", keyID, err)
	}

	if out.KeySpec != types.KeySpecRsa2048 {
		return "", fmt.Errorf("%w: got %q", ErrUnsupportedKeySpec, out.KeySpec)
	}
	if out.KeyUsage != types.KeyUsageTypeEncryptDecrypt {
		return "", fmt.Errorf("%w: got %q", ErrUnsupportedKeyUsage, out.KeyUsage)
	}

	if !hasAlgorithm(out.EncryptionAlgorithms, types.EncryptionAlgorithmSpecRsaesOaepSha1) ||
		!hasAlgorithm(out.EncryptionAlgorithms, types.EncryptionAlgorithmSpecRsaesOaepSha256) {
		return "", fmt.Errorf("%w: got %v", ErrMissingAlgorithms, out.EncryptionAlgorithms)
	}

	if len(out.PublicKey) == 0 {
		return "", ErrEmptyPublicKey
	}

	parsed, err := x509.ParsePKIXPublicKey(out.PublicKey)
	if err != nil {
		return "", fmt.Errorf("kmspubkey: parse PKIX public key: %w", err)
	}

	rsaPub, ok := parsed.(*rsa.PublicKey)
	if !ok {
		return "", fmt.Errorf("%w: parsed type %T", ErrNotRSAPublicKey, parsed)
	}

	if got := rsaPub.N.BitLen(); got != expectedRSABits {
		return "", fmt.Errorf("%w: got %d bits", ErrWrongRSABitLength, got)
	}

	pemBytes := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY", // PKIX, matches what x509.MarshalPKIXPublicKey produces
		Bytes: out.PublicKey,
	})
	return string(pemBytes), nil
}

// hasAlgorithm reports whether a slice of KMS EncryptionAlgorithmSpec
// contains the target value. KMS returns a slice for asymmetric keys.
func hasAlgorithm(specs []types.EncryptionAlgorithmSpec, want types.EncryptionAlgorithmSpec) bool {
	for _, s := range specs {
		if s == want {
			return true
		}
	}
	return false
}

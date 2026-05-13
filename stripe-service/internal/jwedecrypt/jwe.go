package jwedecrypt

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/kms/types"
)

// algRSAOAEP / algRSAOAEPSHA256 / encA256GCM enumerate the algorithm
// values we accept in the JWE protected header.
const (
	algRSAOAEP        = "RSA-OAEP"
	algRSAOAEPSHA256  = "RSA-OAEP-256"
	encA256GCM        = "A256GCM"
	expectedCEKLength = 32 // bytes; AES-256
	expectedIVLength  = 12 // bytes; GCM nonce for A256GCM
	expectedTagLength = 16 // bytes; GCM auth tag for A256GCM
)

// parsedJWE is the result of splitting a compact JWE into its five
// segments and validating the protected header. The header is not
// retained — anything we'd want to read out of it (alg, enc) is
// either checked or projected into a downstream-ready field.
type parsedJWE struct {
	// aad is the raw ASCII bytes of segment 0 itself (the
	// base64url-encoded form, NOT the decoded JSON). Per RFC 7516
	// §5.1.10, this is the AAD passed to AES-GCM.
	aad []byte
	// wrappedCEK is the RSA-OAEP-wrapped Content Encryption Key
	// (segment 1, decoded). Hand off to KMS for unwrap.
	wrappedCEK []byte
	// iv is the AES-GCM nonce (segment 2, decoded). Always 12 bytes
	// — verified up front.
	iv []byte
	// ciphertext is the AES-GCM-encrypted plaintext (segment 3, decoded).
	ciphertext []byte
	// authTag is the AES-GCM authentication tag (segment 4, decoded).
	// Always 16 bytes — verified up front.
	authTag []byte
	// kmsAlg is the KMS EncryptionAlgorithmSpec corresponding to the
	// header's alg value. Computed once during parsing — projecting
	// it here (instead of carrying the raw alg string and re-switching
	// in the decrypter) makes the post-validation state unforgeable
	// and removes a "should be unreachable" branch.
	kmsAlg types.EncryptionAlgorithmSpec
}

// parseJWE splits the compact serialization, base64url-decodes the
// segments, validates the protected header, and projects the algorithm
// into a KMS-ready spec.
//
// On any structural failure, returns a wrapped sentinel error so
// callers can branch on errors.Is.
func parseJWE(s string) (*parsedJWE, error) {
	parts := strings.Split(s, ".")
	if len(parts) != 5 {
		return nil, fmt.Errorf("%w: got %d", ErrMalformedJWE, len(parts))
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("jwedecrypt: decode protected header (segment 0): %w", err)
	}

	// Decode into a typed struct for alg/enc + a separate Crit field.
	// Per RFC 7515 §4.1.11 (inherited by 7516), recipients MUST reject
	// JWEs listing critical extension parameters they don't understand.
	// We don't understand any extensions, so any non-empty Crit array
	// is a hard reject. Other unknown header fields are fine — JWE
	// permits arbitrary extension parameters as long as they aren't
	// listed in `crit`.
	var hdr struct {
		Alg  string   `json:"alg"`
		Enc  string   `json:"enc"`
		Crit []string `json:"crit"`
	}
	if err := json.Unmarshal(headerBytes, &hdr); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidHeader, err)
	}
	if len(hdr.Crit) > 0 {
		return nil, fmt.Errorf("%w: got %v", ErrUnsupportedHeader, hdr.Crit)
	}

	var kmsAlg types.EncryptionAlgorithmSpec
	switch hdr.Alg {
	case algRSAOAEP:
		kmsAlg = types.EncryptionAlgorithmSpecRsaesOaepSha1
	case algRSAOAEPSHA256:
		kmsAlg = types.EncryptionAlgorithmSpecRsaesOaepSha256
	default:
		return nil, fmt.Errorf("%w: got %q", ErrUnsupportedAlg, hdr.Alg)
	}
	if hdr.Enc != encA256GCM {
		return nil, fmt.Errorf("%w: got %q", ErrUnsupportedEnc, hdr.Enc)
	}

	wrappedCEK, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("jwedecrypt: decode wrapped CEK (segment 1): %w", err)
	}
	iv, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("jwedecrypt: decode IV (segment 2): %w", err)
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return nil, fmt.Errorf("jwedecrypt: decode ciphertext (segment 3): %w", err)
	}
	authTag, err := base64.RawURLEncoding.DecodeString(parts[4])
	if err != nil {
		return nil, fmt.Errorf("jwedecrypt: decode auth tag (segment 4): %w", err)
	}

	// Up-front length checks on IV and tag give operators a clear
	// "Stripe sent garbage" signal distinct from "tamper detected"
	// (both would otherwise surface as an AES-GCM open failure).
	if len(iv) != expectedIVLength {
		return nil, fmt.Errorf("%w: got %d bytes", ErrInvalidIVSize, len(iv))
	}
	if len(authTag) != expectedTagLength {
		return nil, fmt.Errorf("%w: got %d bytes", ErrInvalidAuthTagSize, len(authTag))
	}

	return &parsedJWE{
		aad:        []byte(parts[0]),
		wrappedCEK: wrappedCEK,
		iv:         iv,
		ciphertext: ciphertext,
		authTag:    authTag,
		kmsAlg:     kmsAlg,
	}, nil
}

// decryptContent runs AES-256-GCM decryption with the provided CEK,
// IV, ciphertext, auth tag, and AAD. Reconstructs the (ciphertext ||
// authTag) form that crypto/cipher.AEAD.Open expects.
//
// The caller must verify len(cek) == expectedCEKLength before calling
// (Decrypter.Decrypt does this); aes.NewCipher returns a less helpful
// error otherwise.
func decryptContent(cek, iv, ciphertext, authTag, aad []byte) ([]byte, error) {
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, fmt.Errorf("jwedecrypt: aes.NewCipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("jwedecrypt: cipher.NewGCM: %w", err)
	}

	// crypto/cipher's AES-GCM expects ciphertext and tag concatenated
	// into a single slice — JWE keeps them in separate segments.
	sealed := make([]byte, len(ciphertext)+len(authTag))
	copy(sealed, ciphertext)
	copy(sealed[len(ciphertext):], authTag)

	plaintext, err := aead.Open(nil, iv, sealed, aad)
	if err != nil {
		// Wrap with ErrAuthenticationFailed so callers can branch on
		// errors.Is — this is the security-relevant signal (any
		// modification to ciphertext, tag, IV, AAD, or CEK lands here).
		return nil, fmt.Errorf("%w: %v", ErrAuthenticationFailed, err)
	}
	return plaintext, nil
}

package jwedecrypt

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kms"
)

// kmsDecrypter is the slice of *kms.Client this package needs.
// Production wiring passes the real *kms.Client; tests inject a fake
// that returns a known plaintext CEK without going to AWS.
type kmsDecrypter interface {
	Decrypt(
		ctx context.Context,
		in *kms.DecryptInput,
		opts ...func(*kms.Options),
	) (*kms.DecryptOutput, error)
}

// Decrypter decrypts Stripe JWE compact serializations using a
// configured asymmetric KMS CMK to unwrap the per-response CEK.
type Decrypter struct {
	kms   kmsDecrypter
	keyID string
}

// New validates inputs and returns a Decrypter ready for use. keyID
// is the KMS CMK alias or ARN, e.g. "alias/dev-airo-stripe-managed-keys".
func New(kmsClient kmsDecrypter, keyID string) (*Decrypter, error) {
	if kmsClient == nil {
		return nil, errors.New("jwedecrypt: kms client is required")
	}
	if keyID == "" {
		return nil, errors.New("jwedecrypt: keyID is required")
	}
	return &Decrypter{kms: kmsClient, keyID: keyID}, nil
}

// Decrypt parses the compact JWE, asks KMS to unwrap the CEK using
// the configured CMK and the algorithm spec dictated by the JWE
// header, then AES-256-GCM decrypts the content in-process.
//
// Returns the plaintext bytes. The recovered plaintext is a
// secret-bearing value (Stripe sk_live_* / ek_live_*); callers are
// responsible for hygiene like overwriting the returned slice once
// it has been handed off to downstream storage. The library
// deliberately does not zero on the caller's behalf — that would
// require either an Into([]byte) API (clunky) or unilateral
// overwriting on a buffer the caller might still need.
func (d *Decrypter) Decrypt(ctx context.Context, jwe string) ([]byte, error) {
	parsed, err := parseJWE(jwe)
	if err != nil {
		return nil, err
	}

	out, err := d.kms.Decrypt(ctx, &kms.DecryptInput{
		KeyId:               aws.String(d.keyID),
		CiphertextBlob:      parsed.wrappedCEK,
		EncryptionAlgorithm: parsed.kmsAlg,
	})
	if err != nil {
		return nil, fmt.Errorf("jwedecrypt: kms unwrap CEK: %w", err)
	}

	cek := out.Plaintext
	if len(cek) != expectedCEKLength {
		return nil, fmt.Errorf("%w: got %d", ErrInvalidCEKSize, len(cek))
	}

	return decryptContent(cek, parsed.iv, parsed.ciphertext, parsed.authTag, parsed.aad)
}

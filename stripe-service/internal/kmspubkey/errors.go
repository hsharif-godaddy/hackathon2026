package kmspubkey

import "errors"

// Sentinel errors returned by fetchAndValidate / Cache.PEM. Callers
// branch via errors.Is — sentinels rather than typed structs because
// none of these errors carry per-instance metadata that callers would
// pull out and act on differently.
var (
	// ErrUnsupportedKeySpec is returned when KMS reports a key spec
	// other than RSA_2048 — the integration explicitly requires that
	// size for compatibility with Stripe's documented JWE shape.
	ErrUnsupportedKeySpec = errors.New("kmspubkey: unsupported KeySpec (want RSA_2048)")

	// ErrUnsupportedKeyUsage is returned when KMS reports KeyUsage
	// other than ENCRYPT_DECRYPT (e.g. SIGN_VERIFY). A SIGN_VERIFY
	// CMK can return a parseable public PEM but kms:Decrypt will fail.
	ErrUnsupportedKeyUsage = errors.New("kmspubkey: unsupported KeyUsage (want ENCRYPT_DECRYPT)")

	// ErrMissingAlgorithms is returned when the CMK doesn't list both
	// RSAES_OAEP_SHA_1 and RSAES_OAEP_SHA_256 in its supported
	// EncryptionAlgorithms. internal/jwedecrypt switches on the JWE
	// header alg, so we need both available.
	ErrMissingAlgorithms = errors.New("kmspubkey: CMK does not support both RSAES_OAEP_SHA_1 and RSAES_OAEP_SHA_256")

	// ErrEmptyPublicKey is returned when KMS returns an empty
	// PublicKey field — should never happen for a healthy asymmetric
	// CMK, but worth catching defensively rather than passing empty
	// bytes to x509.ParsePKIXPublicKey.
	ErrEmptyPublicKey = errors.New("kmspubkey: KMS returned empty PublicKey bytes")

	// ErrNotRSAPublicKey is returned when the parsed DER is a valid
	// public key of a different kind (ECDSA, Ed25519, etc.).
	ErrNotRSAPublicKey = errors.New("kmspubkey: parsed key is not an RSA public key")

	// ErrWrongRSABitLength is returned when the parsed RSA key isn't
	// 2048 bits. Defense-in-depth against KMS reporting the wrong
	// KeySpec or returning a different key than advertised.
	ErrWrongRSABitLength = errors.New("kmspubkey: RSA key is not 2048 bits")
)

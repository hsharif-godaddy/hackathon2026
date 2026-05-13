package jwedecrypt

import "errors"

// Sentinel errors returned by parseJWE / Decrypter.Decrypt. Callers
// branch via errors.Is — sentinels rather than typed structs because
// none of these errors carry per-instance metadata that callers would
// pull out and act on differently.
var (
	// ErrMalformedJWE is returned when the input doesn't have exactly
	// five base64url-encoded segments separated by dots.
	ErrMalformedJWE = errors.New("jwedecrypt: malformed JWE: expected 5 base64url segments")

	// ErrInvalidHeader is returned when segment 0 base64url-decodes
	// successfully but the bytes are not valid JSON.
	ErrInvalidHeader = errors.New("jwedecrypt: protected header is not valid JSON")

	// ErrUnsupportedAlg is returned when the header's alg is not one
	// of the RSA-OAEP variants we handle. Operators can distinguish
	// "JWE was malformed" from "Stripe rotated to a new algorithm we
	// don't yet support" by errors.Is on this sentinel.
	ErrUnsupportedAlg = errors.New("jwedecrypt: unsupported alg (want RSA-OAEP or RSA-OAEP-256)")

	// ErrUnsupportedEnc is returned when the header's enc is not A256GCM.
	ErrUnsupportedEnc = errors.New("jwedecrypt: unsupported enc (want A256GCM)")

	// ErrUnsupportedHeader is returned when the protected header
	// carries a non-empty `crit` array. Per RFC 7515 §4.1.11 (inherited
	// by 7516), recipients MUST reject JWEs listing critical extension
	// parameters they don't understand. We don't understand any
	// extensions, so any non-empty `crit` is a hard reject — the
	// forward-compatibility safety mechanism the spec defines.
	ErrUnsupportedHeader = errors.New("jwedecrypt: protected header has unsupported critical extensions")

	// ErrInvalidIVSize is returned when the JWE's IV segment isn't
	// 12 bytes (the GCM nonce size for A256GCM). Up-front check so
	// operators can distinguish "Stripe sent garbage" from "tamper
	// signal" — both would otherwise surface as an AES-GCM open error.
	ErrInvalidIVSize = errors.New("jwedecrypt: JWE IV is not 12 bytes (required for A256GCM)")

	// ErrInvalidAuthTagSize is returned when the auth tag segment isn't
	// 16 bytes (the GCM tag size for A256GCM). Same rationale as
	// ErrInvalidIVSize.
	ErrInvalidAuthTagSize = errors.New("jwedecrypt: JWE auth tag is not 16 bytes (required for A256GCM)")

	// ErrInvalidCEKSize is returned when KMS unwraps to a plaintext
	// that isn't 32 bytes (the AES-256 key size). This is a defensive
	// guard — KMS returning a wrong-sized blob would otherwise produce
	// a confusing aes.NewCipher error deep inside the GCM path.
	ErrInvalidCEKSize = errors.New("jwedecrypt: KMS returned wrong-sized plaintext (want 32 bytes for AES-256)")

	// ErrAuthenticationFailed is returned when AES-GCM Open rejects the
	// ciphertext. This is the primary tamper / forgery signal — any
	// modification to the ciphertext, auth tag, IV, AAD, or CEK
	// surfaces here. Operators / callers can branch on errors.Is to
	// distinguish authentication failures from KMS / parse errors.
	ErrAuthenticationFailed = errors.New("jwedecrypt: AES-GCM authentication failed (tampered or forged JWE)")
)

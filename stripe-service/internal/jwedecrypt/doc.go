// Package jwedecrypt decrypts the JWE compact serializations Stripe
// returns from v2.iam.apiKeys.create for type=secret_key (and the
// future type=mcp_key).
//
// The JWE format is RFC 7516 (https://datatracker.ietf.org/doc/html/rfc7516)
// — five base64url-encoded segments joined by dots:
//
//	<protected_header>.<encrypted_cek>.<iv>.<ciphertext>.<auth_tag>
//
// The wrapping algorithm is RSA-OAEP or RSA-OAEP-256 (header alg);
// content encryption is AES-256-GCM (header enc=A256GCM). The RSA
// private half lives in AWS KMS as a non-exportable asymmetric CMK,
// so the per-response CEK is unwrapped via kms.Decrypt; the plaintext
// CEK never leaves KMS until that call returns. The content is then
// AES-256-GCM decrypted in-process using stdlib crypto/aes +
// crypto/cipher.
//
// The Additional Authenticated Data (AAD) passed to AES-GCM is the raw
// base64url-encoded segment 0 (ASCII bytes), per RFC 7516 §5.1.10 —
// not the decoded JSON header.
//
// Library-only — this package does not contact AWS by itself; callers
// pass a kmsDecrypter (typically *kms.Client) to New. Plaintext
// returned by Decrypt is secret-bearing (sk_live_* / ek_live_*) and
// the caller is responsible for any hygiene such as zeroing the
// buffer after handoff.
package jwedecrypt

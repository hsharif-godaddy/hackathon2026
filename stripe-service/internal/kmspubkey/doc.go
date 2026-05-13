// Package kmspubkey fetches, validates, and caches the RSA public PEM
// from a KMS asymmetric CMK. The PEM is sent inline in every
// v2.iam.apiKeys.create request body for type=secret_key /
// type=mcp_key — Stripe wraps the per-response Content Encryption Key
// against whichever PEM the request carried.
//
// The library validates several invariants at fetch time so that a
// misconfigured CMK fails the boot loudly rather than silently
// 401-ing every Stripe call for the lifetime of the process:
//
//   - KeySpec == RSA_2048 (CDK provisions this; widening can come later)
//   - KeyUsage == ENCRYPT_DECRYPT (rejects SIGN_VERIFY)
//   - EncryptionAlgorithms includes both RSAES_OAEP_SHA_1 and
//     RSAES_OAEP_SHA_256 — required so internal/jwedecrypt can match
//     either alg in the response header
//   - Public bytes are non-empty, parse via x509.ParsePKIXPublicKey
//     into an *rsa.PublicKey, and the modulus is 2048 bits
//
// PEM-encoded via PKIX (Type: "PUBLIC KEY") to match the format the
// integration plan §4.2.1 documents and that Stripe expects.
//
// Cache discipline: lazy fetch on first PEM() call via sync.Once,
// errors cached too. Public halves of CMKs are immutable for the
// lifetime of the CMK; rotation happens by recreating the CMK with a
// new ARN, which is the wiring layer's concern (operator restarts the
// process).
package kmspubkey

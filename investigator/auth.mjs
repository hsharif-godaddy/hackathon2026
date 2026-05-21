// Pure auth helpers for the investigator Lambda. Kept dep-free so they
// can be unit-tested without installing the AWS SDK / gd-auth-client
// (which lives in GoDaddy's private Artifactory registry and is not
// resolvable from a clean workstation without `.npmrc`).

// Decode a JWT's expiry and return it as Unix epoch ms. Throws on
// malformed input or missing payload segment.
//
// JWT payload is base64url-encoded (RFC 7519 §3); plain `'base64'` would
// silently mis-decode any `-` or `_` chars in the segment. Node 16+
// supports `'base64url'` directly; the Lambda base image is nodejs:22.
//
// GoCode S2S JWTs (as observed against `sso.godaddy.com` and
// `sso.test-godaddy.com`) ship only `iat` — there is no `exp` claim.
// We treat `iat + GOCODE_JWT_LIFETIME_MS` as the assumed expiry, which
// matches GoCode's documented 30-minute token lifetime. If the issuer
// ever starts setting `exp`, we honor it preferentially.
//
// An earlier revision threw on missing `exp` to surface JWT-shape drift,
// but that broke against real GoCode tokens; the iat-based assumption
// is the correct invariant for this issuer.
//
// NOTE: cross-reference for the three near-identical decoders in this
// codebase. Divergence is intentional:
//   - `app/src/lib/crm/airo-cert-token.ts` — cert-realm SSO (BFF). Returns
//     null on missing `exp`, falls back to FALLBACK_TTL_MS (50 min).
//   - `investigator/crm-token.mjs` — cert-realm SSO (Lambda). Same null +
//     FALLBACK_TTL_MS semantics as the BFF.
//   - This file — GoCode S2S (Lambda). Different issuer; `exp` provably
//     absent. THROWS when both `exp` and `iat` are missing rather than
//     silently caching, because for this issuer "no claims" is a real
//     shape-drift signal worth surfacing loud.
const GOCODE_JWT_LIFETIME_MS = 30 * 60 * 1000;

export function decodeJwtExpMs(jwt) {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) throw new Error('Invalid JWT format');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (typeof payload.exp === 'number') return payload.exp * 1000;
  if (typeof payload.iat === 'number') return payload.iat * 1000 + GOCODE_JWT_LIFETIME_MS;
  throw new Error(
    `JWT has neither 'exp' nor 'iat' claim (iss=${payload.iss ?? 'unknown'}, kid=${payload.kid ?? 'unknown'})`,
  );
}

// Build the env to hand to the Claude CLI child process. We intentionally
// do NOT pass `process.env` verbatim: the Lambda env exposes the execution
// role's AWS_* credentials (AccessKey, SecretKey, SessionToken) which the
// CLI has no reason to see. With `--dangerously-skip-permissions` the CLI
// may shell out (Bash tool) on content it processes, so a prompt-injection
// attack in a log line could in theory read them from env. Passing only
// the vars Claude CLI / the skill require keeps that blast radius tight.
//
// Returns a null-prototype object so the child cannot inherit prototype
// pollution from this process.
export function buildChildEnv() {
  const allow = [
    // PATH / runtime basics — without these `claude` can't resolve node/python.
    'PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ',
    // Claude CLI config + its auth against GoCode.
    'CLAUDE_CONFIG_DIR',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
    // Skill-side: JOMAX scopes downstream API calls; REPORT_DIR is where
    // the skill writes its final markdown; CONSOLE_BASE steers the
    // frontend-log searcher at the right console env.
    'JOMAX_TOKEN',
    'REPORT_DIR',
    'CONSOLE_BASE',
    // Direct evidence mode (source=feedback): bypasses console, queries
    // Loki / EB Langfuse / ES / FullStory directly using these credentials.
    'INVESTIGATION_DIRECT_MODE',
    'LOKI_ENDPOINT',
    'LOKI_API_KEY',
    'EB_LANGFUSE_BASE_URL',
    'EB_LANGFUSE_PUBLIC_KEY',
    'EB_LANGFUSE_SECRET_KEY',
    'AIRO_BUILDER_ES_ENDPOINT',
    'AIRO_BUILDER_ES_API_KEY',
    'CONTROL_PLANE_ES_ENDPOINT',
    'CONTROL_PLANE_ES_API_KEY',
    'FULLSTORY_API_KEY',
    'FULLSTORY_MCP_URL',
    'ENVIRONMENT_NAME',
    // Node runtime flags (source maps for traces).
    'NODE_OPTIONS',
  ];
  const env = Object.create(null);
  for (const k of allow) {
    const v = process.env[k];
    if (typeof v === 'string') env[k] = v;
  }
  return env;
}

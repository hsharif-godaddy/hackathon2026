# Security Reviewer

Scan for security vulnerabilities, data integrity risks, and performance blockers.

## Critical Blockers (Must Fix)

### Security
- Exposed secrets/credentials in code or config files
- SQL injection (string concatenation in queries)
- XSS (unescaped user input in HTML/templates)
- Template injection (SSTI: user input in server-side template rendering)
- Command injection (unsanitized input to shell commands)
- Missing input validation on user-provided data
- Bypassed authentication or authorization checks (must use gd-auth library per CLAUDE.md)
- Timing attacks on cryptographic operations
- IDOR vulnerabilities (insecure direct object references)
- Sensitive data logged or committed (passwords, tokens, PII in code, logs, or commit messages)
- Missing auth level checks on sensitive routes (see CLAUDE.md auth section)

### LLM Security (OWASP Top 10 for LLM Apps)
- Prompt injection: user input concatenated into prompts without sanitization or structural delimiters
- Prompt injection (indirect): external data (URLs, files, DB rows, API responses) injected into LLM context without validation
- Insecure output handling: LLM output passed to eval(), exec(), subprocess, SQL queries, or HTML rendering without sanitization
- Insecure output handling: LLM output used to construct file paths, URLs, or shell commands without validation
- Excessive agency: LLM granted unrestricted shell/filesystem/database/network access without scope limits
- Excessive agency: destructive operations (delete, send, publish, transfer) executed without human confirmation
- Sensitive data in prompts: API keys, secrets, PII embedded in system prompts or context
- Sensitive data exposure: user data from one session/tenant leaking into another through shared context
- System prompt leakage: system instructions returned in API responses or extractable via adversarial queries
- Security logic in prompts: authorization or rate limiting enforced via prompt instructions instead of application code

### Data Integrity
- Race conditions in concurrent code
- Data loss risks (delete without confirmation, missing backups)
- Missing database transactions for multi-step operations
- Breaking database migrations (dropped columns without migration path)

### Concurrency
- Shared mutable state without synchronization
- Synchronous I/O in async contexts (blocking event loops)

## Major Concerns (Should Fix)

### Performance
- N+1 queries (database calls inside loops)
- O(n^2) algorithms when O(n) or O(n log n) is possible
- Loading full datasets instead of streaming/pagination
- Unbounded loops, missing pagination
- Sync work on hot paths that should be async/batched

### LLM Resource Management
- No token or character limits on LLM input
- Missing timeouts on LLM API calls
- No rate limiting or per-user quotas on LLM endpoints
- Recursive or chained LLM calls without depth limits

### Breaking Changes
- API changes without versioning
- Removed functionality without migration path or deprecation

## Severity Classification

- [Critical]: Data loss, security holes, auth bypass, injection, sensitive data exposure
- [Important]: N+1 queries, race conditions, missing transactions, breaking changes, LLM resource issues
- [Suggestion]: Minor performance improvements, defense-in-depth additions

## Exclusions

- Do NOT flag style preferences, naming, documentation, code organization
- Do NOT flag pre-existing issues in unchanged code
- Do NOT flag test files for production security rules
- Do NOT flag theoretical vulnerabilities without a concrete attack vector in the diff

## Verification

Before reporting [Critical] or [Important]:
1. Confirm the vulnerability is reachable (not dead code or behind existing guards)
2. Check if the issue is already mitigated by middleware, framework defaults, or code outside the diff
3. Verify auth bypass claims against the actual route registration and middleware chain
4. For injection: confirm user-controlled input actually reaches the vulnerable sink

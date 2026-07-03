---
name: security
description: Fix and verify security vulnerabilities reported by the security scanner
whenToUse: >-
  User wants to fix security vulnerabilities, address issues found in the
  Security tab, or verify that security fixes have been applied. Phrases like
  "fix security vulnerabilities", "fix security issues", "fix these findings",
  "address the vulnerabilities", "security scan", "run security analysis",
  "verify security fixes", "Ask Airo to Fix" from the Security tab.
intents:
  - fix security vulnerabilities
  - fix security issues
  - security scan
  - security analysis
  - address vulnerabilities
  - verify security fixes
  - security tab
  - fix these findings
---

# Security Skill

Fix reported security vulnerabilities and verify the outcome.

## Fix Verification

After fixing security vulnerabilities, always call `security__runSecurityVerification` as your **final step**, then immediately report in the same response:

- How many of the reported issues were resolved
- How many remain by severity (critical, high, medium, low)
- Any that still need attention

If `incompleteScanners` is non-empty, tell the user which scanner categories did not complete and that those findings could not be verified.

If `success` is `false`, tell the user the scan failed and include the `error` message so they know verification was not possible.

# Zip Import Feature - Implementation Plan

## Overview

This document captures design decisions and implementation details for the zip import feature.

---

## Design Decisions

### 1. Separate Temp Directory for Uploads

**Decision:** Uploaded zip files are written to a separate temp directory (`/tmp/airo-imports/`)
before validation, then copied to the app's shared mount for container-side processing.

**Alternatives Considered:**

| Approach                      | Description                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------- |
| Direct write to app directory | Write zip directly to `/tmp/apps/{appId}/.import.zip` via custom multer storage |
| Stream to container           | Stream upload through dev-supervisor directly to container filesystem           |

**Why We Chose Separate Temp Directory:**

1. **Security Isolation**: Untrusted uploads are kept separate from the app directory
   until they pass security validation (path traversal, zip bombs, format checks).
   This prevents potentially malicious files from ever touching the app's filesystem.

2. **Simplicity**: Standard multer disk storage is battle-tested and reliable.
   Custom storage engines add complexity and potential failure points.

3. **Clean Architecture**: Clear boundary between "incoming/untrusted" data and
   "validated app data". The temp directory is the quarantine zone.

4. **Container Isolation**: The app directory is mounted in the preview container.
   If file watchers or other processes monitor that directory, having untrusted
   zip files appear there (even temporarily) could cause issues.

**Cost Analysis:** The extra copy operation (temp → app directory) is negligible since it's
same-filesystem and the real cost is container-side extraction.

**Code Reference:** `agents/src/server/routes/git.ts` - `TEMP_UPLOAD_DIR`

---

### 2. Container-Side Processing

**Decision:** After validation on the agent, the zip is copied to the container's shared mount
and all heavy operations (extraction, file manipulation, npm install, build) run inside the
container via dev-supervisor exec commands.

**Previous Approach:** All operations ran on the agent using Node.js fs APIs.

**Why We Changed:**

| Benefit                 | Explanation                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Resource Isolation      | Heavy I/O operations (extracting thousands of files) happen in the container, not the agent |
| Performance             | File operations within the container are local, avoiding cross-mount overhead               |
| Environment Consistency | Files are manipulated in the same environment where they'll run                             |
| Scalability             | Agent's memory/disk isn't impacted by large imports                                         |

**Code Reference:** `agents/src/services/ProjectImportService.ts` - `extractZipInContainer`,
`validateProjectInContainer`, `copyFilesInContainer` methods

---

### 3. Security Validation on Agent

**Decision:** All security checks (path traversal, zip bombs, format validation) happen on the
agent before the zip enters the container.

**Rationale:**

- Agent is the trusted boundary - validation must happen before untrusted data enters the container
- ZipSecurityService runs on agent where we have full control
- Container should only receive pre-validated, safe content

**Code Reference:** `agents/src/services/ZipSecurityService.ts`

---

## Import Flow

1. Validate zip on agent (security: path traversal, zip bombs, etc.)
2. Copy zip to container via shared filesystem
3. Extract zip inside container using dev-supervisor exec
4. Validate project structure (package.json, scripts)
5. Replace app files with imported content
6. Run npm install and build inside container
7. Git commit and restart dev server

**Code Reference:** `agents/src/services/ProjectImportService.ts`

---

## File Structure

| File                                                      | Purpose                                         |
| --------------------------------------------------------- | ----------------------------------------------- |
| `agents/src/server/routes/git.ts`                         | API routes for import (POST/GET/DELETE)         |
| `agents/src/services/ProjectImportService.ts`             | Import orchestration, container-side operations |
| `agents/src/services/ZipSecurityService.ts`               | Security validation (agent-side)                |
| `agents/src/database/repositories/ImportJobRepository.ts` | Job tracking                                    |
| `agents/src/types/import.ts`                              | TypeScript types and enums                      |

---

## Access Control

### Capability-Based (Primary)

The zip import feature uses **capability-based access control** via `/alloc/config.json`:

| Capability             | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `CODE_SYNC_ZIP_UPLOAD` | Required to upload zip files and replace codebase |

**Config Structure:**

```json
{
  "CAPABILITIES": {
    "VALUE": ["CODE_SYNC_ZIP_UPLOAD"],
    "SYSTEM_MANAGED": true
  }
}
```

### Environment Variables (Backward Compatibility)

| Variable            | Default             | Description                                            |
| ------------------- | ------------------- | ------------------------------------------------------ |
| `ENABLE_ZIP_IMPORT` | `false`             | **DEPRECATED** - Temporary backward compatibility flag |
| `IMPORT_TEMP_DIR`   | `/tmp/airo-imports` | Temp directory for uploaded zips before validation     |

> **⚠️ DEPRECATED**: `ENABLE_ZIP_IMPORT` is temporary for backward compatibility.
> Once capability config is fully deployed, this flag will be removed and access control
> will rely solely on `CODE_SYNC_ZIP_UPLOAD` capability.

---

---

## Authentication

The zip import feature requires authentication for both the mgmt-airo API (app creation) and the agent API (import).

### Overview

| API       | Auth Method                   | Purpose                           |
| --------- | ----------------------------- | --------------------------------- |
| mgmt-airo | AWS IAM / Service credentials | Create apps, manage subscriptions |
| Agent     | Agent JWT token               | Import zip files, check status    |

**Important:** These are separate authentication systems with different tokens.

---

### mgmt-airo API Authentication

**Contact the platform team for mgmt-airo service credentials.**

mgmt-airo uses AWS-based authentication for external consumers, not customer SSO tokens.
The specific authentication mechanism depends on your integration type:

- **Internal services**: AWS IAM roles / service accounts
- **External partners**: Contact platform team for credentials

```bash
# Example request (authentication method varies)
curl -X POST "https://mgmt.nstk.net/api/airo/v1/..." \
  -H "Authorization: <platform-specific-auth>" \
  -H "Content-Type: application/json"
```

---

### Agent API Authentication

The agent uses a custom RSA-signed JWT token. To get an agent token, you must:

1. **Authenticate to App Builder** (customer auth)
2. **Request an agent token** via `/api/auth/agent-token`
3. **Use the token** for agent API calls

#### Step 1: Get Agent Token

```bash
# Request agent token (requires customer authentication first)
curl -X POST "https://{app-builder-url}/api/auth/agent-token" \
  -H "Authorization: Bearer ${CUSTOMER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"siteId": "{app_id}", "expiresInSeconds": 3600}'

# Response:
# {
#   "token": "eyJhbGciOiJSUzI1NiIs...",
#   "expires": "2024-01-01T12:00:00.000Z",
#   "siteId": "abc123",
#   "type": "jwt"
# }
```

#### Step 2: Use Agent Token

```bash
# Replace codebase
curl -X POST "https://{agent_url}/apps/{app_id}/zip/upload" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -F "zipFile=@project.zip"

# Check status
curl "https://{agent_url}/apps/{app_id}/zip/upload/status" \
  -H "Authorization: Bearer ${AGENT_TOKEN}"
```

### Agent Token Details

| Property  | Value                               |
| --------- | ----------------------------------- |
| Algorithm | RS256 (RSA-signed)                  |
| Max TTL   | 12 hours (43200 seconds)            |
| Scope     | Single site (siteId)                |
| Refresh   | Request new token before expiration |

### Agent JWT Payload

```typescript
interface AgentJWT {
  iss: string; // Issuer (App Builder)
  aud: string; // Audience
  exp: number; // Expiration timestamp
  iat: number; // Issued at timestamp
  siteId: string; // App/site this token is valid for
}
```

## Related Documentation

- [Zip Import Architecture](zip-import-architecture.md) - Full architecture overview, API specs, diagrams
- [V2 Integration](../../V2_INTEGRATION.md) - Full authentication flow details
- [mgmt-airo Client](../../app/src/lib/mgmt-airo/README.md) - API client documentation

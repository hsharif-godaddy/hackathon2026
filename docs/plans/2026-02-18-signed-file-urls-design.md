# Signed File URLs Design

**Date:** 2026-02-18
**Status:** Approved

## Problem

When the frontend loads uploaded files via `<img src="...">`, the browser doesn't include the JWT Authorization header. This causes 401 Unauthorized errors:

```
GET http://localhost:4000/files/uploads/{appId}/{filename} 401 (Unauthorized)
```

## Solution

Implement HMAC-signed URLs that don't require JWT authentication. The signature validates the request instead.

## Design Decisions

| Decision         | Choice          | Rationale                                       |
| ---------------- | --------------- | ----------------------------------------------- |
| URL expiry       | 24 hours        | Balances security with usability                |
| Signing endpoint | Agents only     | Simpler, fewer hops                             |
| Signing time     | At upload       | No extra API calls needed                       |
| Legacy migration | Ignore          | Recent feature, acceptable to require re-upload |
| Fallback UI      | Icon + filename | Shows attachment badge instead of broken image  |

## URL Format

```
/files/uploads/{appId}/{filename}?sig={signature}&exp={expiry}
```

Example:

```
/files/uploads/abc123/abc123_1739900000_file_xyz.jpg?sig=a1b2c3d4e5f6&exp=1739986400
```

## Signature Algorithm

```typescript
const message = `${appId}:${filename}:${exp}`;
const sig = HMAC - SHA256(message, GODADDY_OAUTH_ENCRYPTION_KEY).base64url();
```

- **appId** prevents cross-app URL reuse
- **filename** prevents filename swapping
- **exp** (Unix timestamp) prevents indefinite access
- Uses existing `GODADDY_OAUTH_ENCRYPTION_KEY` (256-bit, deployed everywhere)

## Implementation

### 1. New Utility: `agents/src/utils/file-url-signer.ts`

```typescript
import { createHmac } from "node:crypto";
import { getEncryptionKey } from "../services/token-crypto.js";

const SIGNATURE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export function signFileUrl(appId: string, filename: string): string {
  const exp = Math.floor((Date.now() + SIGNATURE_EXPIRY_MS) / 1000);
  const message = `${appId}:${filename}:${exp}`;
  const sig = createHmac("sha256", getEncryptionKey())
    .update(message)
    .digest("base64url");

  return `/files/uploads/${appId}/${filename}?sig=${sig}&exp=${exp}`;
}

export function verifyFileSignature(
  appId: string,
  filename: string,
  sig: string,
  exp: number,
): boolean {
  if (exp < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const message = `${appId}:${filename}:${exp}`;
  const expectedSig = createHmac("sha256", getEncryptionKey())
    .update(message)
    .digest("base64url");

  return sig === expectedSig;
}
```

### 2. File Serving Endpoint: `agents/src/server/routes/files.ts`

Accept either JWT auth or valid signature:

```typescript
router.get("/uploads/:appId/:filename", async (req, res) => {
  const { appId, filename } = req.params;
  const { sig, exp } = req.query;

  // Path 1: Signed URL (no JWT needed)
  if (sig && exp) {
    const expNum = parseInt(exp as string, 10);
    if (!verifyFileSignature(appId, filename, sig as string, expNum)) {
      return res.status(401).json({ error: "Invalid or expired signature" });
    }
    // Signature valid - serve file
  }
  // Path 2: JWT auth (existing behavior)
  else {
    // ... existing JWT + ownership validation
  }

  // ... file serving logic
});
```

### 3. Upload Response: `agents/src/server/routes/files.ts`

Add `signedUrl` to each file in response:

```typescript
const result = await fileUploadService.processUpload(appId, files);

const filesWithSignedUrls = result.files.map((file) => ({
  ...file,
  signedUrl: signFileUrl(appId, file.filename),
}));

return res.json({
  uploadId: result.uploadId,
  files: filesWithSignedUrls,
});
```

### 4. Frontend: `app/src/app/develop/components/chat/`

**FileUploadButton.tsx** - Add to interface:

```typescript
export interface UploadedFile {
  // ... existing fields
  signedUrl?: string;
}
```

**ChatPane.tsx** - Use signedUrl:

```typescript
const fileUrl = file.signedUrl ? `${agentUrl}${file.signedUrl}` : undefined;
```

**AssetInline.tsx** - Handle missing imageUrl for images:

```typescript
{activeAsset.mediaType === MediaType.IMAGE && activeAsset.imageUrl ? (
  <img src={getAssetDisplayUrl(activeAsset)} ... />
) : activeAsset.mediaType === MediaType.IMAGE ? (
  // Fallback: icon + filename
  <div className={...}>
    <ImageIcon />
    <text.div>{label}</text.div>
  </div>
) : ...
```

## Security

- Signature includes appId - can't reuse across apps
- Signature includes filename - can't swap files
- 24-hour expiry limits exposure window
- JWT path remains for API consumers
- Cross-origin policy headers unchanged

## Testing

### Unit Tests

- Valid signature verifies
- Expired signature rejected
- Tampered signature rejected
- Different appId invalidates
- Different filename invalidates

### Integration Tests

- Signed URL returns file (200)
- Expired URL returns 401
- Invalid signature returns 401
- JWT auth still works

## Error Responses

| Scenario             | Status | Response                                    |
| -------------------- | ------ | ------------------------------------------- |
| Missing sig & no JWT | 401    | `{ error: 'Authentication required' }`      |
| Invalid/expired sig  | 401    | `{ error: 'Invalid or expired signature' }` |
| File not found       | 404    | `{ error: 'File not found' }`               |

## Files to Modify

1. `agents/src/utils/file-url-signer.ts` (new)
2. `agents/src/server/routes/files.ts`
3. `app/src/app/develop/components/chat/FileUploadButton.tsx`
4. `app/src/app/develop/components/chat/ChatPane.tsx`
5. `app/src/app/develop/components/chat/AssetInline.tsx`

# Getty Direct Auth: Investigation Findings

**Date:** 2026-02-26
**Branch:** `jeichorn/image-search-go-service-filters`

## Problem

The image-search-service currently talks to Getty through two proxies:

```
image-search-service → airo-proxy → getty-images-proxy.api.godaddy.com → Getty Images API
   (Bearer token)      (SSO JWT)         (Getty API key, managed by GD)
```

The airo-proxy (`proxy/` in this repo) squashes repeated query params via `URLSearchParams` into comma-separated values. The GoDaddy Getty proxy (`getty-images-proxy.api.godaddy.com`) expects **repeated params** for `fields`:

```
✅ ?fields=display_set&fields=keywords&fields=orientation    → 200 OK with all fields
❌ ?fields=display_set,keywords,orientation                  → 400 "Unknown error"
```

Without `fields`, the GoDaddy Getty proxy returns only `id`, `display_set`, `max_dimensions` — no title, orientation, keywords, artist, etc.

## Verified: Direct SSO JWT Auth Works Locally

Tested successfully from local machine:

```bash
# 1. Get SSO JWT token using client certs
SSO_RESPONSE=$(curl -s --cert /tmp/getty-certs/client.crt --key /tmp/getty-certs/client.key \
  -X POST https://sso.godaddy.com/secure/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "realm=cert")
JWT_TOKEN=$(echo "$SSO_RESPONSE" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data'])")

# 2. Hit Getty proxy directly with repeated fields params
curl -s "https://getty-images-proxy.api.godaddy.com/v1/search?phrase=business+meeting&pageSize=1\
&fields=display_set&fields=max_dimensions&fields=title&fields=orientation\
&fields=graphical_style&fields=keywords&fields=artist&fields=collection_code" \
  -H "Authorization: sso-jwt $JWT_TOKEN" \
  -H "Accept: application/json" \
  -H "x-app-key: airo-app-builder"
```

Response includes all requested fields:

```
artist: 'pixelfit'
collection_code: 'EPL'
display_sizes: [8 items]
graphical_style: 'photography'
id: '2193033966'
keywords: [65 items]
max_dimensions: {"height": 4000, "width": 6000}
orientation: 'Horizontal'
title: 'Female entrepreneurs listening to a customer during a meeting'
```

## SSO Token Exchange Protocol

From `gd-auth-client` source (`proxy/node_modules/gd-auth-client/src/get-token-from-certificate-common.js`):

```
POST https://sso.godaddy.com/secure/api/token
Content-Type: application/x-www-form-urlencoded
Body: realm=cert
TLS: Client cert + key

Response (JSON):
{
  "type": "signed jwt",
  "code": 1,
  "message": "Success",
  "data": "<JWT_TOKEN>"
}
```

The JWT is then used as: `Authorization: sso-jwt <JWT_TOKEN>`

**Important:** Must use `sso.godaddy.com` (prod), NOT `sso.test-godaddy.com`. The test endpoint returns tokens that get 401 from the Getty proxy.

## Secrets in AWS Secrets Manager

Profile: `airobuild-dev-private-sso` | Region: `us-west-2`

| Secret                        | Path                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| Client cert                   | `/Katana/Secrets/airobuilde/proxy/dev-private-ecs/GETTY_CERT` |
| Client key                    | `/Katana/Secrets/airobuilde/proxy/dev-private-ecs/GETTY_KEY`  |
| Bearer token (for airo-proxy) | `/Katana/Secrets/airobuilde/app/dev-private-ecs/GETTY_TOKEN`  |

Pull certs locally:

```bash
aws secretsmanager get-secret-value \
  --secret-id "/Katana/Secrets/airobuilde/proxy/dev-private-ecs/GETTY_CERT" \
  --profile airobuild-dev-private-sso --region us-west-2 \
  --query "SecretString" --output text > /tmp/getty-certs/client.crt

aws secretsmanager get-secret-value \
  --secret-id "/Katana/Secrets/airobuilde/proxy/dev-private-ecs/GETTY_KEY" \
  --profile airobuild-dev-private-sso --region us-west-2 \
  --query "SecretString" --output text > /tmp/getty-certs/client.key
```

## GoDaddy Getty Proxy: Available Fields

Source: `/home/jeichorn/s/getty-images-api-proxy/src/types/index.ts` line 73

**Supported response fields** (pass via `fields` param):

```
allowed_use, alternative_ids, artist, asset_family, call_for_image, caption,
collection_code, collection_id, collection_name, color_type, comp, comp_webp,
copyright, date_camera_shot, date_created, date_submitted, detail_set,
display_set, download_product, download_sizes, graphical_style, id,
istock_collection, keywords, largest_downloads, license_model, max_dimensions,
orientation, preview, product_types, quality_rank, referral_destinations,
summary_set, thumb, title, uri_oembed
```

**Default fields** (when none specified): `['display_set', 'max_dimensions']`

**NOT available as response fields** (search filters only):

- `number_of_people` — filter only, not returned per-image
- `ethnicity` — filter only
- `age_of_people` — filter only
- `moods` — filter only

These demographic fields can filter Getty search results but cannot be extracted from the response. They'll need to remain as Qdrant-side filters only if populated by other means (e.g., analysis).

## Fields We Need for Image Search Service

```go
var gettyMetadataFields = []getty.Field{
    getty.FieldDisplaySizes,    // "display_set" (not "display_sizes" — proxy uses display_set)
    getty.FieldMaxDimensions,   // "max_dimensions"
    getty.FieldTitle,           // "title"
    getty.FieldCaption,         // "caption"
    getty.FieldOrientation,     // "orientation"
    getty.FieldGraphicalStyle,  // "graphical_style"
    getty.FieldKeywords,        // "keywords"
    getty.FieldArtist,          // "artist"
    getty.FieldCollectionCode,  // "collection_code"
}
```

Note: The GoDaddy proxy uses `display_set` (not `display_sizes`). `display_set` returns the same display_sizes array. Check our Field constants match.

## Orientation Values

Getty returns capitalized values from the API:

- `Horizontal`, `Vertical`, `Square`, `PanoramicHorizontal`, `PanoramicVertical`

Our Go types use lowercase: `horizontal`, `vertical`, `square`, `panoramic_horizontal`, `panoramic_vertical`

Need to handle case normalization when storing orientation from Getty response.

## Implementation Plan: Bypass Airo-Proxy

### 1. Implement `SSOJWTAuth` in Go

Already stubbed in `image-search-service/internal/getty/auth.go:59-101`. Need to:

- Load client cert + key from files (paths from config)
- POST to `https://sso.godaddy.com/secure/api/token` with `realm=cert` using client TLS
- Parse JSON response, extract `data` field (the JWT)
- Cache token, refresh on expiry (decode JWT `exp` claim)
- Apply as `Authorization: sso-jwt <token>` header

### 2. Update Config

New env vars:

```
GETTY_AUTH_TYPE=sso-jwt          # or "bearer" for backward compat with airo-proxy
GETTY_CERT_PATH=/path/to/client.crt
GETTY_KEY_PATH=/path/to/client.key
GETTY_SSO_HOST=sso.godaddy.com
```

Change default `GETTY_UPSTREAM` to `https://getty-images-proxy.api.godaddy.com`

### 3. Update Setup Script

Add to `setup/src/getty-config.ts` or create new `image-search-config.ts`:

- Pull GETTY_CERT and GETTY_KEY from Secrets Manager
- Save to `image-search-service/certs/` (gitignored)
- Generate `.env` with cert paths + SSO config

### 4. Fix Field Name: `display_set` vs `display_sizes`

The GoDaddy Getty proxy uses `display_set` as the field name (which returns the `display_sizes` array in the response). Verify our `FieldDisplaySizes` constant maps correctly, or add `FieldDisplaySet`.

### 5. Handle Orientation Case

Getty returns `Horizontal`/`Vertical` but our system stores lowercase. Either:

- Normalize to lowercase when storing in `analyzeAndStore()`
- Or store as-is and handle case-insensitive matching in Qdrant filters

### 6. Remove `NumberOfPeople`/`Ethnicity`/`AgeOfPeople` from Qdrant Filters

Since these aren't available as Getty response fields, remove them from:

- `buildFilters()` Qdrant conditions (already removed moods, need to remove demographics too)
- `EnsureCollection()` index creation
- Keep them as Getty search-time filters in `filtersToGettyOptions()`

Or alternatively, keep the Qdrant indexes/filters but document they'll only be populated if we add demographic analysis in the future.

## Existing Auth Code Reference

- `image-search-service/internal/getty/auth.go` — AuthProvider interface, BearerTokenAuth (working), SSOJWTAuth (stubbed)
- `image-search-service/internal/getty/client.go:46-59` — `NewWithAuth()` for custom auth providers
- `proxy/src/auth/sso-client.ts` — Reference implementation of SSO JWT in TypeScript
- `proxy/node_modules/gd-auth-client/src/get-token-from-certificate-common.js` — Raw SSO token exchange

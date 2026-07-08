# Google Ads Performance Max API Implementation Summary

## Overview

This branch adds comprehensive Google Ads Performance Max advertising API client methods to the Airo App Builder's social integration layer, enabling campaign creation, asset management, performance reporting, and conversion tracking through the existing social-v2 proxy architecture.

## Implementation Date
July 1, 2026

## API Specification References

The implementation follows the official Google Ads API specifications (see GOOGLE_ADS_API_VERSION const for latest version):

### Primary Documentation
- **Google Ads API v22 Overview**: https://developers.google.com/google-ads/api/reference/rpc/v22/overview
- **Performance Max Campaign Guide**: https://developers.google.com/google-ads/api/docs/performance-max/overview
- **Performance Max Setup Guide**: https://developers.google.com/google-ads/api/docs/performance-max/setup

### Specific Resource Documentation
- **Customer Resource**: https://developers.google.com/google-ads/api/reference/rpc/v22/Customer
- **Campaign Resource**: https://developers.google.com/google-ads/api/reference/rpc/v22/Campaign
- **AssetGroup Resource**: https://developers.google.com/google-ads/api/reference/rpc/v22/AssetGroup
- **Asset Resource**: https://developers.google.com/google-ads/api/reference/rpc/v22/Asset
- **ConversionAction Resource**: https://developers.google.com/google-ads/api/reference/rpc/v22/ConversionAction
- **GAQL (Google Ads Query Language)**: https://developers.google.com/google-ads/api/docs/query/overview

### API Endpoints
- **Base URL**: `https://googleads.googleapis.com/v22/`
- **Search Endpoint**: `/customers/{customer_id}/googleAds:search`
- **Mutate Endpoints**: `/customers/{customer_id}/{resource}:mutate`

## Files Changed

### 1. Type Definitions
**File**: `app/src/types/social.ts`

**Lines Added**: ~150 lines

**New Types**:
- `GoogleAdsCustomer` - Customer account details with MCC support
- `GoogleAdsCampaign` - Performance Max campaign with budget, status, bidding strategy
- `GoogleAdsAssetGroup` - Asset groups with URLs and assets
- `GoogleAdsAsset` - Image/text/video assets with type-specific fields
- `GoogleAdsCampaignMetrics` - Performance metrics (impressions, clicks, conversions, cost)
- `GoogleAdsConversionAction` - Conversion tracking with tag snippets

**New Enums**:
- `GoogleAdsCampaignStatus` - `ENABLED`, `PAUSED`, `REMOVED`
- `GoogleAdsAssetType` - `IMAGE`, `TEXT`, `VIDEO`, `MEDIA_BUNDLE`
- `GoogleAdsAssetFieldType` - `HEADLINE`, `DESCRIPTION`, `MARKETING_IMAGE`, etc.
- `GoogleAdsConversionCategory` - `PURCHASE`, `LEAD`, `SIGNUP`, `PAGE_VIEW`, etc.

### 2. API Client Implementation
**File**: `app/src/lib/social.ts`

**Lines Added**: ~800 lines

**New Methods**: 13 methods across 5 functional areas

#### Customer/Account Management (MCC Support)
```typescript
listGoogleAdsCustomers(userTokenId: string, developerToken: string): Promise<GoogleAdsCustomer[]>
getGoogleAdsCustomer(userTokenId: string, developerToken: string, customerId: string): Promise<GoogleAdsCustomer>
```

#### Campaign CRUD Operations
```typescript
getGoogleAdsCampaigns(userTokenId: string, developerToken: string, customerId: string, includeRemoved?: boolean): Promise<GoogleAdsCampaign[]>
createGoogleAdsCampaign(userTokenId: string, developerToken: string, customerId: string, params: {...}): Promise<{resourceName, campaignId}>
updateGoogleAdsCampaign(userTokenId: string, developerToken: string, customerId: string, campaignId: string, updates: {...}): Promise<void>
deleteGoogleAdsCampaign(userTokenId: string, developerToken: string, customerId: string, campaignId: string): Promise<void>
```

#### Asset Group Management
```typescript
getGoogleAdsAssetGroups(userTokenId: string, developerToken: string, customerId: string, campaignId: string): Promise<GoogleAdsAssetGroup[]>
createGoogleAdsAssetGroup(userTokenId: string, developerToken: string, customerId: string, params: {...}): Promise<{resourceName, assetGroupId}>
uploadGoogleAdsAsset(userTokenId: string, developerToken: string, customerId: string, params: {...}): Promise<{resourceName, assetId}>
linkGoogleAdsAssetToGroup(userTokenId: string, developerToken: string, customerId: string, params: {...}): Promise<void>
```

#### Performance Reporting
```typescript
getGoogleAdsCampaignMetrics(userTokenId: string, developerToken: string, customerId: string, params: {...}): Promise<GoogleAdsCampaignMetrics[]>
```

#### Conversion Tracking
```typescript
getGoogleAdsConversionActions(userTokenId: string, developerToken: string, customerId: string): Promise<GoogleAdsConversionAction[]>
createGoogleAdsConversionAction(userTokenId: string, developerToken: string, customerId: string, params: {...}): Promise<{resourceName, conversionActionId, tagSnippets}>
```

### 3. Unit Tests
**File**: `app/src/lib/social.test.ts`

**Lines Added**: ~500 lines

**Test Coverage**: 13 test suites covering all Google Ads methods
- Total tests in file: 61 (48 existing + 13 new)
- All tests passing ✅

**Test Categories**:
- Customer/account listing and retrieval
- Campaign CRUD operations with budget lifecycle
- Asset group creation and management
- Asset upload for IMAGE/TEXT/VIDEO types
- Asset linking with field types
- Performance metrics with aggregation
- Conversion action creation with tag snippets

### 4. Bug Fixes (Unrelated)
**File**: `debug-console/src/lib/supportplane/store/feedback-store.ts`

**Change**: Added type annotation to lambda parameter (line 55)
```typescript
// Before
return (res.Table?.KeySchema ?? []).map((k) => k.AttributeName!);

// After
return (res.Table?.KeySchema ?? []).map((k: any) => k.AttributeName!);
```

**Reason**: Fixed TypeScript `noImplicitAny` error blocking pre-commit

## Architecture Patterns

### 1. Social-v2 Proxy Architecture
All Google Ads API calls proxy through the existing social-v2 service:

```
SocialV2Client → social-v2 proxy → Google Ads API v22
```

**Proxy URL Pattern**:
```
https://social-v2.api.{rootDomain}/google/proxy/googleads/v22/{endpoint}
```

**Authentication**: 
- OAuth token passed via `X-Token-Id` header (token reference, not raw token)
- social-v2 dereferences to actual OAuth access token server-side
- Google Ads developer token passed via `developer-token` header (caller-supplied, forwarded by the proxy)

### 2. GAQL (Google Ads Query Language)
Read operations use POST with GAQL queries:

```typescript
const query = `
  SELECT
    campaign.id,
    campaign.name,
    campaign.status
  FROM campaign
  WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
`

fetch(url, {
  method: 'POST',
  body: JSON.stringify({ query })
})
```

### 3. Mutation Operations
Create/update/delete use `:mutate` endpoints with operation arrays:

```typescript
{
  operations: [
    { create: {...} },           // Create new resource
    { update: {...}, updateMask: 'field1,field2' },  // Update specific fields
    { remove: 'resourceName' }   // Soft delete
  ]
}
```

### 4. Resource Name Hierarchy
Google Ads uses hierarchical resource names:
- `customers/{customer_id}`
- `customers/{customer_id}/campaigns/{campaign_id}`
- `customers/{customer_id}/assetGroups/{asset_group_id}`
- `customers/{customer_id}/assets/{asset_id}`

ID extraction pattern: `resourceName.split('/')[index]`

### 5. Micros Convention
Currency and percentages use "micros" (1,000,000 micros = $1.00 or 100%):
- Budget: `10_000_000` micros = $10/day
- CPC: `100_000` micros = $0.10 per click
- ROAS: `4_500_000` micros = 4.5x return

## Key Implementation Details

### Manager Account (MCC) Support
- `listGoogleAdsCustomers()` returns all accessible accounts
- Methods accept `customerId` parameter for multi-account scenarios
- Customer resource includes `manager: boolean` field

### Campaign Lifecycle
1. **Budget Creation First**: Campaigns require a separate budget resource
   ```typescript
   // Step 1: Create budget
   POST /customers/{id}/campaignBudgets:mutate
   
   // Step 2: Create campaign with budget reference
   POST /customers/{id}/campaigns:mutate
   ```

2. **Default Status**: Campaigns created with `status: 'ENABLED'` as customer review has occurred before the campaign is created

### Asset Group Requirements
Performance Max campaigns require:
- At least one asset group per campaign
- Asset groups must have final URLs
- Minimum assets per group:
  - 1-5 headlines
  - 1-5 descriptions
  - 1 business name
  - 1+ marketing images

### Performance Metrics Aggregation
- Metrics are returned per-day per-campaign
- Client-side aggregation groups by campaign
- Calculates averages: `averageCpc = costMicros / clicks`, `ctr = clicks / impressions`

### Conversion Tracking Tag Generation
- `createGoogleAdsConversionAction()` returns:
  - `globalSiteTag`: gtag.js snippet (install once)
  - `eventSnippet`: Conversion event code (per conversion type)

## Testing Strategy

### Unit Test Approach
- Mock `globalThis.fetch` with Vitest
- Verify request construction (URL, method, headers, body)
- Validate response mapping to TypeScript types
- Test error handling paths
- Verify aggregation/calculation logic

### Test Helpers Used
- `mockResponse()` - Success responses
- `mockFailedResponse()` - Error responses
- `getLastFetchUrl()` - Inspect request URLs
- Mock constants for IDs, tokens, URLs

### Coverage Areas
✅ Endpoint correctness
✅ Header authentication (`X-Token-Id`, `developer-token`)
✅ GAQL query structure
✅ Mutation operation format
✅ Resource name parsing
✅ Optional parameter handling
✅ Error response handling
✅ Metric aggregation logic

## Dependencies

### Backend Coordination Required
The social-v2 team must implement proxy support:

**Route**: `/google/proxy/googleads/v22/*`

**Requirements**:
1. Forward POST requests to `https://googleads.googleapis.com/v22/*`
2. Dereference `X-Token-Id` header to OAuth access token
3. Forward `developer-token` header supplied by the client (no server-side injection needed)
4. Include `login-customer-id` header for MCC accounts
5. Handle token refresh for expired credentials

**OAuth Scope Required**: `https://www.googleapis.com/auth/adwords`

### Frontend Dependencies
None. This implementation only modifies:
- Type definitions (`app/src/types/social.ts`)
- API client (`app/src/lib/social.ts`)
- Unit tests (`app/src/lib/social.test.ts`)

No UI components, hooks, or routing changes required for the API client layer.

## Verification Status

### Type Safety
✅ All methods have explicit TypeScript types
✅ No `any` types in public APIs (only internal parsing)
✅ Proper enum usage for statuses and categories

### Code Quality
✅ ESLint passes with `--max-warnings 0`
✅ Follows existing `SocialV2Client` patterns
✅ Comprehensive JSDoc documentation
✅ Consistent error handling

### Testing
✅ 61/61 tests passing
✅ All Google Ads methods covered
✅ Edge cases tested (empty results, errors, aggregation)

### Integration Readiness
⏳ **Blocked on backend**: Requires social-v2 proxy implementation

## Future Enhancements (Out of Scope)

Not included in this implementation:

1. **React Query Hooks**: `useGoogleAdsCampaigns()`, `useCreateCampaign()`, etc.
2. **UI Components**: Campaign management dashboard, asset library
3. **OAuth Flow**: Google Ads authentication (handled by auth team)
4. **Connection Management**: `GoogleAdsConnection` type and creation flow
5. **Bulk Operations**: Create multiple campaigns/assets in one call
6. **Search Campaigns**: Non-Performance Max campaign types
7. **Advanced Reporting**: Custom metrics, attribution models, audience insights
8. **Budget Optimization**: Recommendations and auto-adjustments

## Git Commit History

```bash
# Type definitions
feat(social): add Google Ads Performance Max type definitions

# API client implementation
feat(social): add Google Ads Performance Max API client methods

# Unit tests
test(social): add comprehensive tests for Google Ads methods

# Bug fix
fix(debug-console): add type annotation to feedback-store lambda
```

## Breaking Changes

**All 13 GoogleAds methods have a new required `developerToken: string` parameter** inserted as the second argument (after `userTokenId`, before `customerId`). Any existing call sites must be updated to pass the developer token.

```typescript
// Before
client.getGoogleAdsCampaigns(userTokenId, customerId)

// After
client.getGoogleAdsCampaigns(userTokenId, developerToken, customerId)
```

All other types and non-GoogleAds methods are unchanged.

## Migration Guide

### For Future UI Integration

```typescript
import { socialV2Client } from '@/lib/social'

// 1. List accessible customers (MCC support)
const customers = await socialV2Client.listGoogleAdsCustomers(userTokenId, developerToken)
const customerId = customers[0].id

// 2. Create a Performance Max campaign
const { campaignId } = await socialV2Client.createGoogleAdsCampaign(
  userTokenId,
  developerToken,
  customerId,
  {
    name: 'Summer Sale 2026',
    budgetAmountMicros: 50_000_000, // $50/day
    biddingStrategy: 'MAXIMIZE_CONVERSIONS',
    startDate: '2026-07-01',
    endDate: '2026-08-31',
  }
)

// 3. Create asset group
const { assetGroupId } = await socialV2Client.createGoogleAdsAssetGroup(
  userTokenId,
  developerToken,
  customerId,
  {
    campaignId,
    name: 'Summer Products',
    finalUrls: ['https://example.com/summer-sale'],
  }
)

// 4. Upload and link assets
const { assetId } = await socialV2Client.uploadGoogleAdsAsset(
  userTokenId,
  developerToken,
  customerId,
  {
    type: GoogleAdsAssetType.TEXT,
    text: '50% Off Summer Sale!',
  }
)

await socialV2Client.linkGoogleAdsAssetToGroup(
  userTokenId,
  developerToken,
  customerId,
  {
    assetGroupId,
    assetId,
    fieldType: GoogleAdsAssetFieldType.HEADLINE,
  }
)

// 5. Query performance metrics
const metrics = await socialV2Client.getGoogleAdsCampaignMetrics(
  userTokenId,
  developerToken,
  customerId,
  {
    campaignIds: [campaignId],
    startDate: '2026-07-01',
    endDate: '2026-07-31',
  }
)

console.log(`Campaign: ${metrics[0].campaignName}`)
console.log(`Impressions: ${metrics[0].impressions}`)
console.log(`Clicks: ${metrics[0].clicks}`)
console.log(`Cost: $${metrics[0].costMicros / 1_000_000}`)
console.log(`Conversions: ${metrics[0].conversions}`)
```

## Performance Considerations

### Request Optimization
- Campaign creation requires 2 API calls (budget + campaign)
- Metric queries can filter by campaign IDs to reduce response size
- Asset uploads should be batched per asset group

### Caching Recommendations
- Customer list: 10+ minutes (rarely changes)
- Campaign list: 5-10 minutes
- Asset groups: 5-10 minutes
- Metrics: 1-5 minutes (depends on reporting freshness needs)
- Conversion actions: 10+ minutes

### Rate Limiting
Google Ads API has rate limits. Recommended client-side throttling:
- 5 queries per second (QPS) per customer account
- Implement exponential backoff on 429 (rate limit) responses
- Batch operations when possible

## Security & Privacy

### Token Handling
- ✅ OAuth tokens never exposed to client (token reference only)
- ✅ Token dereference happens server-side in social-v2
- ✅ Follows existing social integration auth pattern

### Data Access
- Users can only access customers they have OAuth permission for
- MCC accounts can access sub-accounts if granted
- social-v2 enforces OAuth scope validation

### PII Considerations
- Campaign/asset names may contain business information
- Conversion data includes user behavior metrics
- Follow existing GoDaddy data handling policies

## Documentation References

### Internal Documentation
- Social architecture: `app/CLAUDE.md` (Chat Transport, BFF Layer, Feature Flags)
- Root architecture: `CLAUDE.md` (Deployment Topology, Services)

### External Resources
- [Google Ads API Client Libraries](https://developers.google.com/google-ads/api/docs/client-libs)
- [Google Ads API Forum](https://groups.google.com/g/adwords-api)
- [Performance Max Best Practices](https://support.google.com/google-ads/answer/10682188)

## Support & Troubleshooting

### Common Issues

**Issue**: "Customer not found" error
- **Cause**: User doesn't have access to the customer ID
- **Solution**: Use `listGoogleAdsCustomers()` to get accessible customers

**Issue**: "Failed to create campaign budget" error
- **Cause**: Invalid budget amount or currency
- **Solution**: Verify `budgetAmountMicros` is positive and reasonable

**Issue**: "Asset group requires minimum assets" error
- **Cause**: Performance Max requires minimum asset counts
- **Solution**: Upload at least 1 headline, 1 description, 1 image before activating

**Issue**: 401 Unauthorized
- **Cause**: OAuth token expired or invalid
- **Solution**: Re-authenticate user through OAuth flow

## Contributors

- Implementation: Claude Code (Anthropic)
- Review: [To be assigned]
- Product Owner: [To be assigned]

## License

Internal GoDaddy proprietary code. Not for public distribution.

---

**End of Implementation Summary**

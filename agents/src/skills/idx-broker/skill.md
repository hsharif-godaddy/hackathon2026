---
name: idx-broker
description: IDX Broker integration for real estate property listings
whenToUse: Customer needs to display real estate listings from IDX Broker on their website. Phrases like "real estate listings", "property listings", "MLS listings", "IDX Broker", "featured properties".
intents:
  - real estate listings/properties/MLS/IDX Broker/featured properties
post-install-notes: |
  CRITICAL: After installing IDX Broker templates, you MUST:
  1. Collect IDX_BROKER_API_KEY via requestSecrets (user needs to provide their API key)
  2. Add route to /src/routes.tsx for /featured-listings path
  3. Add navigation link in /src/App.tsx
  4. Confirm installation complete to user
  DO NOT skip these steps.
---

# IDX Broker Integration Skill

**Purpose:** Integrate with IDX Broker API to display featured real estate property listings on customer websites.

---

## 🚨 CRITICAL INSTRUCTION - READ FIRST 🚨

**THIS SKILL USES PRE-BUILT TEMPLATES. YOU MUST NOT BUILD ANYTHING MANUALLY.**

When this skill is loaded (user wants IDX Broker integration, property listings, real estate listings, etc.), you MUST immediately run:

```typescript
skill({ action: 'install', skill: 'idx-broker' });
```

**DO NOT:**
- Write code manually
- Create files with str_replace_based_edit_tool
- Say "I'll build the integration"
- Create API routes or components yourself

**The templates are already built. Just install them with the command above.**

---

## When to Use This Skill

**User says:**

- "Add IDX Broker integration"
- "Show property listings"
- "Display real estate listings"
- "Add featured properties"
- "Connect IDX Broker"
- "Show MLS listings"
- "I want to display properties from IDX Broker"

**What this skill does:**

- ✅ Installs IDX Broker integration templates
- ✅ Fetches featured listings from IDX Broker API
- ✅ Displays properties in responsive grid
- ✅ Handles API key securely via secrets
- ✅ Validates API key automatically on first use

**Prerequisites:**

- User must have an IDX Broker account and API key
- Application must be using React + React Router

---

## How to Respond When This Skill is Loaded

User says: **"add IDX Broker integration"** or **"show property listings"** or **"display real estate listings"** or **"connect IDX Broker"** or similar

**Your response - FOLLOW THIS EXACTLY:**

1. ✅ Run `skill({ action: 'install', skill: 'idx-broker' })` - This copies all templates
2. ✅ Collect IDX_BROKER_API_KEY via requestSecrets
3. ✅ Add route to `/src/routes.tsx`
4. ✅ Add navigation link to `/src/App.tsx`
5. ✅ Confirm: "IDX Broker integration installed at `/featured-listings`!"
6. ❌ **DO NOT create any files manually**
7. ❌ **DO NOT use str_replace_based_edit_tool to create GET.ts, PropertyCard.tsx, etc.**
8. ❌ **DO NOT say "I'll build the integration"**

**The templates are pre-built. You are INSTALLING them, not BUILDING them.**

---

## Step-by-Step Installation

**READ THIS ENTIRE SECTION BEFORE DOING ANYTHING**

When user says **"add IDX Broker integration"** or **"show property listings"**, follow these steps IN ORDER:

---

### Step 0: Install Templates - REQUIRED FIRST STEP

**⚠️⚠️⚠️ STOP AND READ THIS ⚠️⚠️⚠️**

**FIRST: You MUST run this EXACT command:**

```typescript
skill({
  action: 'install',
  skill: 'idx-broker',
});
```

**This is NOT optional. This is NOT a suggestion. You MUST use the skill install command.**

---

**❌❌❌ DO NOT DO ANY OF THE FOLLOWING ❌❌❌**

DO NOT:
- ❌ Say "I'll build the integration now"
- ❌ Say "Let me create the backend proxy routes"
- ❌ Say "I'll create the API routes and components"
- ❌ Manually create `src/server/api/idx-broker/featured/GET.ts`
- ❌ Manually create `src/components/PropertyCard.tsx`
- ❌ Manually create `src/pages/FeaturedListings.tsx`
- ❌ Manually create `src/lib/types.ts`
- ❌ Use `str_replace_based_edit_tool` to create these files
- ❌ Build anything from scratch
- ❌ Write any code manually

**✅✅✅ INSTEAD, YOU MUST ✅✅✅**

DO:
- ✅ Run the `skill({ action: 'install', skill: 'idx-broker' })` command IMMEDIATELY
- ✅ Let the skill tool copy all template files automatically
- ✅ Tell the user "Installing IDX Broker templates..."
- ✅ Wait for the skill install to complete before doing anything else

---

**What this does:**

- Directly copies all template files from the skill to the app directory
- No templates pass through LLM context (faster, more reliable, cheaper)
- Automatically maps paths to correct destinations:
  - `components/*.tsx` → `src/components/*.tsx`
  - `pages/*.tsx` → `src/pages/*.tsx`
  - `lib/*.ts` → `src/lib/*.ts`
  - `server/api/**/*.ts` → `src/server/api/**/*.ts`

**Template files installed:**

1. **API Route:** `src/server/api/idx-broker/featured/GET.ts` - Server-side endpoint to fetch listings
2. **PropertyCard Component:** `src/components/PropertyCard.tsx` - Individual listing card display
3. **FeaturedListings Page:** `src/pages/FeaturedListings.tsx` - Main listings grid page
4. **Type Definitions:** `src/lib/types.ts` - TypeScript types for IDX Broker API

**Important:** The install action handles all file copying automatically - you don't need to use str_replace_based_edit_tool!

---

### Step 1: Collect IDX Broker API Key

**AFTER installing templates, collect the API key using `requestSecrets`:**

```typescript
requestSecrets({
  title: 'IDX Broker API Key',
  description: 'Enter your IDX Broker API access key to fetch property listings. You can find this in your IDX Broker account settings under Account Settings → API.',
  secrets: [
    {
      name: 'IDX_BROKER_API_KEY',
      description: 'IDX Broker API access key',
      required: true,
    },
  ],
  mode: 'add',
});
```

---

### Step 2: Add Page to Routes

**Read `/src/routes.tsx` first**, then add the FeaturedListings route:

```typescript
import FeaturedListings from './pages/FeaturedListings';

// In routes array:
{
  path: '/featured-listings',
  element: <FeaturedListings />,
}
```

### Step 3: Add to Navigation

**Read the navigation file (usually `/src/App.tsx`)**, then add a navigation link:

```typescript
<a href="/featured-listings">Featured Properties</a>
```

### Step 4: Confirm Installation

Tell the user:

```
✅ IDX Broker integration installed!
- Featured listings page available at /featured-listings
- The page will fetch your properties from IDX Broker API
- First load will validate your API key automatically
```

---

## How It Works

### Data Flow

1. **User visits** the FeaturedListings page
2. **Page calls** `/api/idx-broker/featured` API route
3. **API route**:
   - Retrieves `IDX_BROKER_API_KEY` from secrets
   - Makes request to IDX Broker API
   - Transforms response from object to array
   - Returns listings to frontend
4. **Page displays** listings in responsive grid using PropertyCard components

### Validation

API key validation happens **implicitly on first use**:

- If API key is invalid (401/403), the API route returns an error
- Error message displays in the UI: "Invalid IDX Broker API key"
- User can update the key in secrets settings

No separate validation step is needed - the first page load serves as validation.

---

## Customization

### Adjusting the Grid Layout

The FeaturedListings page uses a responsive grid:
- **Mobile:** 1 column
- **Tablet:** 2 columns
- **Desktop:** 3 columns

To change column counts, edit the grid classes in `FeaturedListings.tsx`:

```typescript
// Current: 1-2-3 columns
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"

// Alternative: 1-2-4 columns
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8"
```

### Customizing the Property Card

Edit `PropertyCard.tsx` to:
- Show/hide specific fields (acres, property type, etc.)
- Change layout (horizontal vs vertical)
- Modify styling (colors, borders, shadows)
- Add custom actions (save, share buttons)

### Filtering and Sorting

The featured listings endpoint returns all featured properties. To add filtering:

1. Fetch listings in parent component
2. Filter array based on criteria (price range, bedrooms, location)
3. Pass filtered array to grid component

Example:

```typescript
const filteredListings = listings.filter(listing =>
  parseInt(listing.bedrooms) >= minBeds &&
  parseFloat(listing.listingPrice.replace(/[$,]/g, '')) <= maxPrice
);
```

---

## Troubleshooting

### "IDX_BROKER_API_KEY not configured"

**Cause:** API key secret is missing

**Solution:**
1. Run `requestSecrets` again to collect the key
2. Or manually add the secret via secrets settings

### "Invalid IDX Broker API key"

**Cause:** API key is incorrect or expired

**Solution:**
1. Verify the key in IDX Broker account settings
2. Update the secret with the correct key
3. Refresh the page to try again

### "Failed to fetch listings"

**Cause:** Network error or IDX Broker API is down

**Solution:**
1. Check internet connection
2. Verify IDX Broker service status
3. Try again after a few minutes

### No Listings Displayed

**Possible causes:**
- No featured listings in IDX Broker account
- API key has restricted access

**Solution:**
1. Log into IDX Broker and verify featured listings exist
2. Check API key permissions in IDX Broker settings

---

## API Details

### Endpoint

`GET https://api.idxbroker.com/clients/featured`

### Required Headers

- `Content-Type: application/x-www-form-urlencoded`
- `accesskey: {YOUR_API_KEY}`
- `outputtype: json` (recommended)

### Response Format

IDX Broker returns an **object** (not array) with listing IDs as keys:

```json
{
  "a000!%5362657": {
    "listingID": "5362657",
    "address": "20 Ingram Street",
    "cityName": "Forest Hills",
    "state": "NY",
    "zipcode": "11375",
    "listingPrice": "$1,151,000",
    "bedrooms": "3",
    "totalBaths": "2.75",
    "sqFt": "2,760",
    "image": {
      "0": {"url": "...", "caption": "..."},
      "totalCount": "3"
    },
    "fullDetailsURL": "https://..."
  }
}
```

**Key points:**
- Use `Object.values()` to convert to array
- All numeric fields are strings
- Primary image is at `image["0"].url`
- `listingPrice` includes formatting ($1,151,000)

---

## Common Mistakes

### ❌ Don't assume response is an array

```typescript
// Wrong
const listings = await response.json();
listings.map(listing => ...)  // Error: listings is object, not array
```

```typescript
// Correct
const data = await response.json();
const listings = Object.values(data);
listings.map(listing => ...)  // Works!
```

### ❌ Don't treat numeric fields as numbers

```typescript
// Wrong
if (listing.bedrooms > 2) ...  // String comparison, won't work correctly
```

```typescript
// Correct
if (parseInt(listing.bedrooms) > 2) ...
```

### ❌ Don't use simple array access for images

```typescript
// Wrong
const image = listing.image[0]  // Undefined, image is object not array
```

```typescript
// Correct
const image = listing.image["0"]  // or listing.image?.["0"]
```

---

## Additional Resources

- [IDX Broker API Documentation](https://middleware.idxbroker.com/docs/api/methods/index.html)
- [IDX Broker Support](https://support.idxbroker.com/)

---


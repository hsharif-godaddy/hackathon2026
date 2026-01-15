---
name: google-maps
description: Add maps, location display, store locator, or Google Maps to applications
dependencies:
  - '@vis.gl/react-google-maps'
---

# Google Maps Skill

Add map functionality using static embeds or dynamic interactive maps.

---

## When to Use

User mentions: "map", "location", "Google Maps", "store locator", "directions"

---

## Flow - FOLLOW THIS ORDER

### Step 1: Ask user which type of map is required

> "Which type of map would you like?
>
> **Static Map**:
>
> - zoom, satellite view, street view, directions
> - Best for: single location, contact page, business address
>
> **Dynamic Map** (requires Google Maps API key):
>
> - Multiple custom markers, info windows, pan and zoom
> - Best for: multiple locations, interactive exploration, store locator"

### Step 2: Install

```typescript
skill({ action: 'install', skill: 'google-maps' });
```

---

## Static Map

### Usage

```tsx
import StaticMap from '@/components/StaticMap';

// Basic
<StaticMap location="Empire State Building, NYC" />

// With custom height and zoom
<StaticMap location="123 Main St, City" height={600} zoom={17} />
```

---

## Dynamic Map

### ⚠️ Only use if user EXPLICITLY requests these features:

- Multiple markers on one map
- Store locator with search
- Custom info popups (click marker to show details)
- Programmatic control

### Request API Key (only after confirming user needs dynamic)

```typescript
requestSecrets({
  title: 'Google Maps API Key',
  description: 'Get from Google Cloud Console. Enable Maps JavaScript API.',
  secrets: [{ name: 'GOOGLE_MAPS_API_KEY', required: true }],
  mode: 'add',
});
```

> **⚠️ API Key Security**: The API key is exposed to the browser (required for Maps JavaScript API). Instruct users to restrict the key in Google Cloud Console:
>
> 1. Go to **APIs & Services → Credentials**
> 2. Click the API key → **Application restrictions**
> 3. Select **HTTP referrers (websites)**
> 4. Add allowed domains (e.g., `https://yourdomain.com/*`)

### Usage

```tsx
import DynamicMap from '@/components/DynamicMap';

// Basic
<DynamicMap center={{ lat: 40.7128, lng: -74.006 }} />

// With markers and info windows
<DynamicMap
  center={{ lat: 40.7128, lng: -74.006 }}
  zoom={12}
  height={500}
  markers={[
    { lat: 40.7128, lng: -74.006, label: 'HQ', description: 'Main office' },
    { lat: 40.758, lng: -73.985, label: 'Branch', description: 'Downtown location' },
  ]}
/>

// Custom center label (when no markers provided)
<DynamicMap
  center={{ lat: 40.7128, lng: -74.006 }}
  centerLabel="Our Location"
/>
```

---

## Props

### StaticMap

| Prop       | Type               | Default  | Description           |
| ---------- | ------------------ | -------- | --------------------- |
| `location` | `string`           | required | Address or place name |
| `height`   | `number \| string` | `450`    | Container height      |
| `zoom`     | `number`           | `15`     | Zoom level (1-20)     |

### DynamicMap

| Prop          | Type                                        | Default      | Description                              |
| ------------- | ------------------------------------------- | ------------ | ---------------------------------------- |
| `center`      | `{ lat: number, lng: number }`              | required     | Map center coordinates                   |
| `zoom`        | `number`                                    | `15`         | Zoom level (1-20)                        |
| `height`      | `number \| string`                          | `450`        | Container height                         |
| `markers`     | `Array<{ lat, lng, label?, description? }>` | `[]`         | Markers to display                       |
| `centerLabel` | `string`                                    | `'Location'` | Label for center marker (if no markers)  |
| `className`   | `string`                                    | `''`         | Additional CSS classes for the container |

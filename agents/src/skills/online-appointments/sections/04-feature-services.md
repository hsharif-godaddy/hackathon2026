# §4 Feature: Services

Two flags work together: admin can manage the service catalog, and customers can browse it publicly.

---

## Enable

In `src/appointment-features.json`:

```json
{
  "features": {
    "admin": {
      "services": { "enabled": true }
    },
    "public": {
      "services_browse": { "enabled": true }
    }
  }
}
```

Enable both for the full experience. `admin.services` lets the admin create/edit/delete services. `public.services_browse` makes them visible on the public booking page.

---

## What it unlocks

| UI | What it does |
|---|---|
| `/admin/services` | Admin list of all services |
| `/admin/services/:id` | Create or edit a service (name, duration, price, description, image) |
| `/book` | Public service grid — customers browse and select a service |
| `/book/:serviceId` | Booking wizard for a specific service |

A service has: name, description, duration (ISO 8601 format, e.g. `"PT60M"` for 60 minutes — never plain numbers), price (decimal major-unit string, e.g. `"650"` for ₹650 or $65 — NOT minor units), category (optional), assigned staff (optional), and custom availability overrides.

---

## ⚠️ Service images are always null after install — fix this immediately

Every service's `imageUrl` is empty after install. Service cards with no image look broken and unfinished. This must be resolved before showing the `/book` page to anyone.

Load the media-image skill, read `src/components/booking/ServiceCard.tsx` to understand the image slot, then generate one image per service using a prompt tailored to the business type and the specific service name. After generating, patch each service via `PATCH /api/appointments/admin/services/:id` to set its image.

**Critical:** The PATCH body field is `image_url` (snake_case). Sending `imageUrl` (camelCase) is silently ignored and the image will not save. The value accepts both relative paths (e.g. `/airo-assets/images/services/hair`) and full URLs.

```typescript
skill({ action: 'load', skill: 'media-image' })
```

Do not leave any service without an image.

---

## ⚠️ Replace static/demo services with live API data — mandatory

This is the most important step when services are enabled. Any hardcoded or demo service data visible on the site must be replaced with live data fetched from the API. Static service lists are a critical bug — they show fake data to real users.

### Homepage service section

Search the homepage (`src/pages/index.tsx` or equivalent) for any hardcoded service arrays, demo card components, or static service content. Common patterns to look for:

```tsx
// ❌ Hardcoded — must be replaced
const services = [
  { name: "Haircut", price: "$50", duration: "45 min" },
  { name: "Color", price: "$120", duration: "90 min" },
];

// ❌ Demo/placeholder components with static props
<ServiceCard name="Sample Service" price="$0" />
```

Replace with a live fetch from the public services API:

```tsx
// ✅ Live data from API
const [services, setServices] = useState<Service[]>([]);

useEffect(() => {
  fetch('/api/appointments/public/services')
    .then(r => r.json())
    .then(data => setServices(data.services ?? []));
}, []);
```

Render loading and empty states — do not show anything until the API responds.

### Dedicated services page

If the site has a standalone services page (`/services`, `/treatments`, or similar), apply the same replacement. Read the file, find any static service data or demo cards, and wire the component to `/api/appointments/public/services`.

If no services page exists but the business has more than 4–5 services, create one at `/services` that:
- Fetches all services from the API on mount
- Groups by category if `admin.categories` is enabled
- Links each service card to `/book/:serviceId`

### What the API returns

```typescript
// GET /api/appointments/public/services
{
  services: [
    {
      id: string,
      name: string,
      description: string | null,
      durationMinutes: number,
      cost: string,         // decimal major-unit string e.g. "650" = ₹650 or $65
      currency: string,     // ISO 4217
      imageUrl: string | null,
      categoryId: string | null,
    }
  ]
}
```

Use `getPublicConfig()` from `@/lib/appointments-client` to get the base URL if constructing absolute image URLs.

---

## Customize

### Service card appearance
Edit `components/booking/ServiceCard.tsx` — controls the card layout on `/book`.

### Service grid layout
Edit `components/booking/ServiceGrid.tsx` — controls how cards are arranged (grid vs. list).

### Pricing display
The price is stored as a decimal major-unit value (e.g. `650.00` = ₹650). Display formatting uses `formatCost(service.cost, currency)` from `components/booking/service-utils.ts` — no division needed.

### Service images — use existing or generate new

When seeding services, always populate `imageUrl` so cards look polished. Follow this priority order:

**1. Reuse existing home-page images first**

Check the site's media slots for images already generated or uploaded on the home page (e.g. `pages/home/hero`, `pages/home/featured-1`, `pages/home/service-1`). If a slot's image matches the service type (a massage service → wellness/spa photo already on the hero), reuse that URL directly. Access existing slot URLs via the `media` tool with `action: 'get'` or by reading the slot path from the app's media registry.

**2. Generate new images if no matching ones exist**

If no suitable image is already in the site's media, load the `media-image` skill and generate a dedicated image per service. Use a descriptive prompt based on the service name, type, and the business's visual style:

```typescript
// Example prompt for a "Deep Tissue Massage" service at a wellness spa
media_image__generate({
  slot: 'services/deep-tissue-massage',
  prompt: 'Professional massage therapist performing deep tissue massage, soft lighting, clean spa environment, warm tones',
  width: 800,
  height: 450,
})
```

Use the returned URL as the service's `imageUrl` when seeding (see §11).

**3. Default service image fallback**

`ServiceCard.tsx` renders no image zone at all when `imageUrl` is absent — the card shows only text content (name, description, duration, price). This is intentional; there is no placeholder. Always generate and set images so the full card renders.

**Naming convention for service image slots:** `services/<service-slug>` (e.g. `services/haircut`, `services/yoga-class`).

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/appointments/public/services` | Public service list (no auth) |
| GET | `/api/appointments/public/services/:id` | Single service detail (no auth) |
| GET | `/api/appointments/admin/services` | Admin service list |
| POST | `/api/appointments/admin/services` | Create service |
| PATCH | `/api/appointments/admin/services/:id` | Update service |
| DELETE | `/api/appointments/admin/services/:id` | Delete service |
| GET | `/api/appointments/admin/services/:id/availability` | Service-level availability |

---

## Notes

- Services must exist before seeding bookings (see §11 Seeding)
- Deleting a service does not delete past bookings — existing bookings store a service snapshot
- If `admin.categories` is enabled (§8), services can be grouped into categories
- If `admin.staff` is enabled (§6), each service can be assigned to specific staff members

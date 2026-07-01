# §8 Feature: Categories & Custom Questions

Two independent features that enhance the booking experience. Categories organize services; questions collect extra info from customers during booking.

---

## Categories

### Enable

```json
{
  "features": {
    "admin": {
      "categories": { "enabled": true }
    }
  }
}
```

### What it unlocks

The admin can create named categories (e.g. "Massages", "Facials", "Hair"). Each service can be assigned to a category. On the public `/book` page, services are grouped by category for easier browsing.

### How to use

1. Go to `/admin` → Categories panel (appears when enabled)
2. Create categories: name + optional description + optional display order
3. Go to `/admin/services/:id` → assign each service to a category
4. The public `/book` page automatically shows the category grouping

### Customize

- **Category display on /book**: Edit `components/booking/ServiceGrid.tsx` — controls how the category headers and grouping look
- **Category order**: Set a `displayOrder` integer when creating categories; lower = shown first

---

## Custom Questions

### Enable

```json
{
  "features": {
    "admin": {
      "questions": { "enabled": true }
    }
  }
}
```

### What it unlocks

The admin can create custom intake questions that appear in booking wizard step 3 (Details form). Examples:
- "Is there anything I should know before your appointment?" (text)
- "How did you hear about us?" (select: Social media / Friend / Google / Other)
- "Do you have any allergies or medical conditions?" (text)

Questions can be per-service or global (shown for all services).

### How to use

1. Go to `/admin` → Questions panel (appears when enabled)
2. Click "New Question"
3. Fill in: label, type (text/textarea/select/checkbox), options (if select), required or optional, and which services it applies to (or "all services")
4. The question automatically appears in the booking form for the relevant services

### Customize

- **Question field rendering**: Edit `components/booking/BookingDetailsForm.tsx` — the `DynamicQuestion` component renders each question type; modify to add new types or change styling
- **Required field indicator**: Controlled via the `required` property on each question; styling in the form component

---

## API endpoints

### Categories

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/appointments/admin/categories` | List categories |
| POST | `/api/appointments/admin/categories` | Create category |
| PATCH | `/api/appointments/admin/categories/:id` | Update category |
| DELETE | `/api/appointments/admin/categories/:id` | Delete category |
| GET | `/api/appointments/public/categories` | Public category list (for /book page) |

### Questions

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/appointments/admin/questions` | List all questions |
| POST | `/api/appointments/admin/questions` | Create question |
| PATCH | `/api/appointments/admin/questions/:id` | Update question |
| DELETE | `/api/appointments/admin/questions/:id` | Delete question |
| GET | `/api/appointments/public/questions` | Get questions for a service (public, no auth) |

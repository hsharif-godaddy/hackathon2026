# Online Appointments v2 — Section Index

This file is the index. Load individual sections on demand as the conversation requires.

| Section | Title | When to load |
|---|---|---|
| §1 | Discovery Questions | Always — read first before touching anything |
| §2 | Install & Configure | After discovery confirmation |
| §3 | Feature: Bookings | Enabling admin bookings management |
| §4 | Feature: Services | Enabling service catalog |
| §5 | Feature: Clients | Enabling client CRM |
| §6 | Feature: Staff | Enabling staff management or exception times |
| §7 | Feature: Coupons | Enabling discount coupon system |
| §8 | Feature: Categories & Questions | Enabling service categories or custom intake questions |
| §9 | Feature: Settings | Enabling business settings panel |
| §10 | Feature: Customer Portal | Enabling customer my-bookings portal |
| §11 | Seeding | Seeding initial data after configuration |
| §12 | User Journeys | Understanding or explaining all user flows |
| §13 | Customization | Changing labels, colors, branding |
| §14 | Admin System | Complete admin guide — auth, layout, navigation, troubleshooting |
| §15 | Authentication | Both auth systems explained — customer (email-only) and admin (token-based) |

## Critical sections for first-time install

**Minimum path:**
1. §1 → §2 (includes admin nav setup + database skill!) → §4 (services) → §11 (seeding with mock account) → §14 (verify admin access)

**Common issues path:**
- Admin login fails? → §15 (auth URLs must be `/api/appointments/admin/auth/...`)
- Can't find admin page? → §2 Step 4 (add professional navigation)
- Provider errors? → §15 (provider tree setup)
- Feature flags not loading? → Check `src/appointment-features.json` path

## When to load §14 (Admin System)

Load this section when:
- User asks "how do I access admin?"
- Admin login returns 404
- AdminAuthProvider errors appear
- User config type error in AdminLayout
- User can't find the admin link in the UI
- Any admin-related troubleshooting

## When to load §15 (Authentication)

Load this section when:
- Customer or admin login fails
- Provider "not found in tree" errors
- SSR crashes with "localStorage is not defined"
- Auth URL confusion (`/api/admin/...` vs `/api/appointments/admin/...`)
- Understanding how email-only customer auth works
- Explaining separation between customer and admin auth

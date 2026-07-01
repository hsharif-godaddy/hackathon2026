# §12 User Journeys

Complete end-to-end flows for every role and use case. Read this section to understand the full system, explain it to the user, or verify that all journeys work after setup.

---

## Journey 1: Customer books an appointment (core flow)

**Requires:** `customer.booking_flow`, `public.services_browse`, at least one service seeded

1. Customer visits `/book`
2. Sees the service grid — cards with service name, duration, and price
3. Clicks a service card → navigated to `/book/:serviceId`
4. **Booking Wizard step 1 — Pick a date**
   - Calendar shows; days with no available slots are greyed out
   - Customer selects an available date
5. **Booking Wizard step 2 — Pick a time**
   - Available time slots appear for the selected date
   - Customer selects a slot
6. **Booking Wizard step 3 — Your details**
   - Fields: first name, last name, email, phone (optional), notes (optional)
   - If `admin.questions` is enabled: custom questions appear here
   - If `customer.booking_flow.coupons` is enabled: coupon code input appears here
   - Customer fills in details and clicks "Continue"
7. **Booking Wizard step 4 — Confirmation**
   - Summary of: service, date, time, name, email
   - If coupon applied: shows discount and final price
   - Customer clicks "Confirm Booking"
8. Booking is created; customer sees a success screen with booking reference
9. (Optional) Email confirmation sent to customer's email

**What can go wrong:**
- Slot no longer available (race condition) → error message, customer re-picks time
- Invalid coupon → validation error inline, customer can proceed without it

---

## Journey 2: Customer views their bookings

**Requires:** `customer.my_bookings` enabled

1. Customer visits `/login` (or clicks "My Bookings" in the header)
2. Enters email (no password needed — email-only lookup)
3. Lands on `/my-bookings` after successful login
4. Sees list of bookings grouped by Upcoming / Past
5. Clicks a booking → `/my-bookings/:id`
6. Sees: service name, staff (if assigned), date, time, status, service location
7. If booking is upcoming and within the cancellation window: "Cancel booking" button is visible
8. Customer clicks "Cancel booking" → confirmation dialog → booking cancelled
9. Booking moves to the Past/Cancelled section

---

## Journey 3: Admin manages bookings

**Requires:** `admin.bookings` enabled, admin logged in

1. Admin visits footer "Staff Login" link → `/admin/login`
2. Enters email + password → token returned → lands on `/admin` dashboard
3. Dashboard shows: upcoming bookings widget, total bookings count, revenue summary
4. Admin clicks "View all bookings" or navigates to `/admin/bookings`
5. Sees full list — sortable by date, filterable by status/service/staff
6. Clicks a booking row → `/admin/bookings/:id`
7. Sees: customer info, service, time, payment status, notes, custom question answers
8. Admin can:
   - Change status (confirm / complete / mark no-show / cancel)
   - Add admin notes
   - View customer profile (link to `/admin/clients/:id`)

---

## Journey 4: Admin manages services

**Requires:** `admin.services` enabled, admin logged in

1. Admin navigates to `/admin/services`
2. Sees list of all services (name, duration, price, active/inactive status)
3. Clicks "New Service" → form appears
4. Fills in: name, description, duration, price, currency, image (optional)
5. If `admin.categories` is enabled: assigns to a category
6. If `admin.staff` is enabled: assigns to specific staff members
7. Saves → service immediately appears on the public `/book` page
8. To edit: click the service → same form, pre-populated
9. To deactivate (hide from booking page without deleting): toggle active status

---

## Journey 5: Admin manages staff

**Requires:** `admin.staff` enabled, admin logged in

1. Admin navigates to `/admin/staff`
2. Sees list of staff members (name, email, assigned services count)
3. Clicks "Add Staff Member" → form
4. Fills in: name, email, bio (optional), photo (optional)
5. Selects which services this staff member provides
6. Saves → staff member can now be assigned to bookings
7. Staff member receives an email with login instructions (if email configured)

---

## Journey 6: Staff member manages their own schedule

**Requires:** `staff.exception_times` enabled, staff member created

1. Staff member visits `/login` and logs in with their credentials
2. Lands on the exception times management page (staff portal)
3. Sees their schedule — calendar view showing their assigned services and any blocked times
4. Clicks "Block time" → form to add an exception:
   - Single date or date range
   - All day or specific hours
   - Optional reason (e.g. "Vacation", "Training")
5. Saves → those times are immediately unavailable in the booking wizard for services assigned to this staff member
6. To remove a block: click it on the calendar → "Remove" button

---

## Journey 7: Admin creates and shares a coupon

**Requires:** `admin.coupons` enabled, admin logged in

1. Admin navigates to `/admin/coupons`
2. Sees list of all coupons (code, type, discount, uses remaining, status)
3. Clicks "New Coupon" → form
4. Fills in:
   - Code: `WELCOME20` (unique, case-insensitive)
   - Type: Percentage or Fixed amount
   - Value: `20` (for 20%)
   - Expiry date: optional
   - Max uses: `100` (or leave blank for unlimited)
5. Saves → coupon is active immediately
6. Admin shares the code with customers (via email, social media, etc.)

---

## Journey 8: Customer uses a coupon during booking

**Requires:** `admin.coupons` + `customer.booking_flow.coupons` both enabled

1. Customer goes through steps 1–2 of the booking wizard (date + time)
2. On step 3 (Details), sees a "Coupon code" input field
3. Types `WELCOME20` → system validates in real-time
4. If valid: green checkmark appears, "20% discount applied — you save $18.00"
5. If invalid/expired/used up: red error message; customer can continue without a code
6. Customer completes booking → confirmation shows the discounted price
7. Coupon use count increments by 1

---

## Journey 9: Admin configures business settings

**Requires:** `admin.settings` (and sub-flags) enabled, admin logged in

1. Admin navigates to `/admin/settings`
2. Settings page shows tabs: Business Info, Location, Timezone, Booking Intervals (only tabs for enabled sub-flags are shown)
3. **Business Info tab**: Edit name, tagline, phone, email, website, upload logo
4. **Location tab**: Edit address — appears on the public booking page for in-person services
5. **Timezone tab**: Pick the business timezone from a dropdown — affects all booking slot display
6. **Booking Intervals tab**: Choose slot granularity (15/30/60 min) — affects the time slot picker in the booking wizard
7. Each tab saves independently (no need to save all at once)

---

## Journey 10: Admin views client records

**Requires:** `admin.clients` enabled, admin logged in

1. Admin navigates to `/admin/clients`
2. Sees list of all clients (name, email, phone, number of bookings, last booking date)
3. Can search by name or email
4. Clicks a client → `/admin/clients/:id`
5. Sees: contact details, full booking history, total spend (if services have prices)
6. Can add admin notes to the client record
7. Can view individual past bookings by clicking them (links to `/admin/bookings/:id`)

# Design Agent - Example Section Outputs

This document provides realistic examples of what the Design Agent will generate for each section. All sections emphasize **brevity and high-level summaries** rather than exhaustive detail.

## Example Context: Healthcare Patient Portal

User Request: _"Create a design system for a healthcare patient portal application"_

---

## 1. Brand Personality

```markdown
# Brand Personality

## Overview

The healthcare patient portal embodies trust, care, and empowerment - creating a calming digital experience that helps patients feel confident managing their health.

## Brand Archetype

**The Caregiver** - Nurturing, protective, and compassionate

## Core Values

- **Trustworthy** - Security and privacy are paramount
- **Caring** - Empathetic approach to patient needs
- **Empowering** - Putting health information in patients' hands
- **Professional** - Medical-grade reliability
- **Accessible** - Easy to use for all ages and abilities

## Personality Traits

- Warm but not overly casual
- Confident but not intimidating
- Supportive but not patronizing
- Modern but not trendy

## Visual Expression

- Clean, uncluttered interfaces
- Soft, rounded edges
- Ample whitespace for clarity
- Calming, nature-inspired colors
- Professional medical imagery
```

---

## 2. Color Palette

```markdown
# Color Palette

## Overview

A calming, trustworthy palette centered on healing blues and natural greens, with warm accents for human connection.

## Primary Colors

### Primary (Medical Blue)

- **Color:** `#2563EB` (Blue-600)
- **Usage:** Primary actions, headers, key information
- **Accessibility:** AAA on white, AA on light backgrounds
- **Psychology:** Trust, stability, medical professionalism

### Primary Foreground

- **Color:** `#FFFFFF` (White)
- **Usage:** Text on primary color
- **Accessibility:** AAA contrast ratio

## Secondary Colors

### Secondary (Healing Teal)

- **Color:** `#14B8A6` (Teal-500)
- **Usage:** Success states, wellness features
- **Accessibility:** AA on white backgrounds

### Accent (Warm Coral)

- **Color:** `#F97316` (Orange-500)
- **Usage:** Urgent actions, important alerts
- **Accessibility:** AAA on white

## Semantic Colors

### Success (Health Green)

- **Color:** `#10B981` (Green-500)
- **Usage:** Completed appointments, positive health metrics

### Warning (Attention Amber)

- **Color:** `#F59E0B` (Amber-500)
- **Usage:** Upcoming appointments, reminders

### Error (Alert Red)

- **Color:** `#EF4444` (Red-500)
- **Usage:** Critical alerts, required actions

## Neutral Colors

- **Background:** `#F9FAFB` (Gray-50)
- **Surface:** `#FFFFFF` (White)
- **Border:** `#E5E7EB` (Gray-200)
- **Text Primary:** `#111827` (Gray-900)
- **Text Secondary:** `#6B7280` (Gray-500)

## WCAG Compliance

All text/background combinations meet WCAG 2.1 Level AA (4.5:1) or AAA (7:1) standards.
```

---

## 3. Typography

```markdown
# Typography

## Overview

Clear, readable typography system optimized for medical information display with professional yet approachable character.

## Font Families

### Primary Font: Inter

- **Usage:** UI elements, navigation, buttons, form labels
- **Weights:** Regular (400), Medium (500), SemiBold (600)
- **Rationale:** Excellent screen readability, professional appearance, widely supported

### Secondary Font: Merriweather

- **Usage:** Headings, article content, patient education materials
- **Weights:** Regular (400), Bold (700)
- **Rationale:** Warm, trustworthy serif that balances professionalism with approachability

### Monospace Font: IBM Plex Mono

- **Usage:** Medical codes, prescription numbers, technical data
- **Weights:** Regular (400), Medium (500)
- **Rationale:** Clear distinction of numerical and code data

## Type Scale

### Desktop Scale

- **Display:** 48px / 56px line-height (Merriweather Bold)
- **H1:** 36px / 44px (Merriweather Bold)
- **H2:** 28px / 36px (Merriweather Bold)
- **H3:** 24px / 32px (Inter SemiBold)
- **H4:** 20px / 28px (Inter SemiBold)
- **Body Large:** 18px / 28px (Inter Regular)
- **Body:** 16px / 24px (Inter Regular)
- **Body Small:** 14px / 20px (Inter Regular)
- **Caption:** 12px / 16px (Inter Medium)

### Mobile Scale

- **Display:** 36px / 44px
- **H1:** 28px / 36px
- **H2:** 24px / 32px
- **H3:** 20px / 28px
- **Body:** 16px / 24px (maintain readability)

## Letter Spacing

- **Headings:** -0.02em (slightly tighter)
- **Body:** 0em (default)
- **All Caps:** 0.05em (buttons, labels)

## Text Colors

- **Primary:** Gray-900 (#111827) on light backgrounds
- **Secondary:** Gray-600 (#4B5563) for supporting text
- **Muted:** Gray-500 (#6B7280) for metadata
- **Inverse:** White (#FFFFFF) on dark backgrounds

## Usage Guidelines

- Use Merriweather for content that requires reading and comprehension
- Use Inter for all interactive elements and short-form text
- Maintain 1.5x line height minimum for body text (WCAG compliance)
- Never use font sizes smaller than 14px for body content
- Use font weight to establish hierarchy before increasing size
```

---

## 4. Iconography & Graphics

```markdown
# Iconography & Graphics

## Overview

Clean, rounded medical iconography that feels professional yet approachable, using a consistent style system.

## Icon Style

### Design System

- **Style:** Rounded line icons
- **Stroke Weight:** 2px
- **Corner Radius:** 2px
- **Canvas:** 24x24px base size
- **Padding:** 2px internal padding

### Icon Sizes

- **Large:** 48px (hero sections, feature highlights)
- **Medium:** 32px (cards, prominent actions)
- **Standard:** 24px (navigation, buttons, inline)
- **Small:** 16px (dense UI, status indicators)

## Icon Library

Using Lucide Icons (or similar) for consistency:

### Core Icons

- **Medical:** Stethoscope, Pill, Heart, Activity, Clipboard
- **Actions:** Calendar, MessageCircle, FileText, Settings, Bell
- **Navigation:** Home, Menu, ChevronRight, ArrowLeft, Plus
- **Status:** CheckCircle, AlertCircle, Info, XCircle

## Color Usage

- **Primary Actions:** Primary Blue (#2563EB)
- **Success/Health:** Green (#10B981)
- **Warning:** Amber (#F59E0B)
- **Error/Urgent:** Red (#EF4444)
- **Neutral:** Gray-600 (#4B5563)

## Medical Imagery

### Photography Style

- **Tone:** Professional, warm, diverse
- **Subject:** Real healthcare settings, diverse patients and providers
- **Treatment:** Natural lighting, authentic moments
- **Avoid:** Stock photo clichés, overly clinical settings

### Illustrations

- **Style:** Simple, friendly, line-based
- **Color:** Use brand palette (blues, teals, warm accents)
- **Usage:** Onboarding, empty states, feature explanations
- **Tone:** Encouraging, non-intimidating

## Graphics Usage

- Use icons to support text, never replace it (accessibility)
- Maintain consistent icon style throughout application
- Ensure 3:1 contrast ratio for icon colors against backgrounds
- Provide text labels for all interactive icons
```

---

## 5. Layout & UI Elements

```markdown
# Layout & UI Elements

## Overview

Consistent spacing and layout system using 8px base unit for visual harmony and efficient development.

## Grid System

### Desktop (1440px+)

- **Container:** 1280px max-width
- **Columns:** 12 columns
- **Gutter:** 24px
- **Margin:** 80px

### Tablet (768px - 1439px)

- **Container:** Fluid
- **Columns:** 8 columns
- **Gutter:** 20px
- **Margin:** 40px

### Mobile (320px - 767px)

- **Container:** Fluid
- **Columns:** 4 columns
- **Gutter:** 16px
- **Margin:** 20px

## Spacing Scale (8px base)

- **0:** 0px
- **1:** 4px (tight spacing)
- **2:** 8px (base unit)
- **3:** 12px
- **4:** 16px (comfortable spacing)
- **6:** 24px (section spacing)
- **8:** 32px
- **12:** 48px (large spacing)
- **16:** 64px (major sections)
- **24:** 96px (page sections)

## Component Patterns

### Cards

- **Padding:** 24px (desktop), 16px (mobile)
- **Border Radius:** 12px
- **Border:** 1px solid Gray-200
- **Shadow:** 0 1px 3px rgba(0,0,0,0.1)
- **Hover:** Shadow increases to 0 4px 6px

### Buttons

- **Padding:** 12px 24px (medium), 8px 16px (small)
- **Border Radius:** 8px
- **Height:** 44px (medium), 36px (small)
- **Font:** Inter Medium, 16px (medium), 14px (small)

### Forms

- **Input Height:** 44px (minimum touch target)
- **Padding:** 12px 16px
- **Border Radius:** 8px
- **Border:** 1px solid Gray-300
- **Focus:** 2px border in Primary Blue
- **Label:** 14px, 8px margin bottom

### Navigation

- **Header Height:** 64px (desktop), 56px (mobile)
- **Sidebar Width:** 280px (desktop), full screen (mobile)
- **Menu Item Height:** 48px (minimum)
- **Padding:** 16px horizontal

## Whitespace Principles

- Increase whitespace around important elements
- Use consistent spacing multiples (8px system)
- Maintain adequate breathing room in medical data displays
- Group related items with tighter spacing
- Separate unrelated items with more space
```

---

## 6. Voice & Messaging

```markdown
# Voice & Messaging

## Overview

Professional yet warm communication that respects patients' intelligence while making healthcare accessible. The tone balances medical professionalism with empathy, using clear language that empowers patients to manage their health confidently.

## Voice Attributes

- **Professional** - Accurate health information with appropriate medical terminology
- **Caring** - Empathetic and supportive without being patronizing
- **Clear** - Avoids jargon, uses active voice and short sentences
- **Empowering** - Frames features as benefits, encourages patient engagement

## Writing Examples

- **Buttons:** "Schedule Appointment", "Send Message", "View Results"
- **Confirmations:** "Appointment scheduled for Tuesday, March 15 at 2:00 PM"
- **Errors:** "We couldn't process your payment. Please check your card details and try again."
- **Empty States:** "No appointments scheduled yet. Ready to book your first visit?"
```

---

## 7. Features

```markdown
# Features

## Overview

Patient portal enabling secure health record access, appointment management, provider communication, and wellness tracking. Core functionality focuses on giving patients convenient digital access to their healthcare information and services.

## Core Features

- **Patient Authentication:** Secure login with two-factor authentication and biometric options
- **Appointment Scheduling:** Book, reschedule, and cancel appointments with in-person and telehealth options
- **Medical Records:** View lab results, medications, diagnoses, and immunization history
- **Secure Messaging:** HIPAA-compliant messaging with healthcare providers
- **Medication Management:** Track current medications and request refills
- **Bills & Payments:** View and pay medical bills with payment plan options
- **Health Metrics:** Track vital signs and sync with wearable devices

## Additional Features

- **Appointment Reminders:** Automated notifications via email and SMS
- **Insurance Management:** View coverage and verify benefits
- **Document Upload:** Share medical documents with providers
- **Family Account Linking:** Manage care for dependents
- **Provider Directory:** Search and review healthcare providers
```

---

## 8. Site Map

```markdown
# Site Map

## Overview

Three-tier structure with public marketing pages, authenticated patient portal, and provider admin interface.

## Page Hierarchy

### Public Pages

- Home (/)
- About (/about)
- Features (/features)
- Support (/support)
- Sign In (/signin)
- Sign Up (/signup)

### Authenticated Patient Pages

- Dashboard (/portal)
- Appointments (/portal/appointments)
  - Schedule (/portal/appointments/schedule)
  - Upcoming (/portal/appointments/upcoming)
  - History (/portal/appointments/history)
- Health Records (/portal/records)
  - Overview (/portal/records/overview)
  - Lab Results (/portal/records/labs)
  - Medications (/portal/records/medications)
  - Documents (/portal/records/documents)
- Messages (/portal/messages)
  - Inbox (/portal/messages/inbox)
  - Compose (/portal/messages/compose)
- Wellness (/portal/wellness)
  - Metrics (/portal/wellness/metrics)
  - Goals (/portal/wellness/goals)
- Billing (/portal/billing)
  - Bills (/portal/billing/bills)
  - Payment (/portal/billing/pay)
  - Insurance (/portal/billing/insurance)
- Profile (/portal/profile)
  - Personal Info (/portal/profile/info)
  - Settings (/portal/profile/settings)
  - Security (/portal/profile/security)

### Provider Pages

- Provider Dashboard (/provider)
- Patients (/provider/patients)
- Schedule (/provider/schedule)
- Messages (/provider/messages)
```

---

## Cross-Section Integration Example

Notice how sections reference each other:

1. **Brand Personality** defines "Calming, professional" → Used in **Color Palette** (healing blues)
2. **Features** lists "Appointment Scheduling" → **Site Map** shows `/portal/appointments/schedule` page
3. **Features** defines "Health Metrics Tracking" → **Site Map** creates `/portal/wellness/metrics` page
4. **Color Palette** specifies primary blue → **Site Map** notes "Primary blue for headers"
5. **Layout** defines 8px grid → **Site Map** applies to all pages

This creates a cohesive design system where all aspects support each other.

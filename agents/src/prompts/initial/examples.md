# Example Patterns

These examples show how to create single-page preview plans for different types of sites.

**Remember:**

- These are PATTERNS to adapt, not templates to copy. Always tailor the plan to the user's specific request.
- **ALWAYS defer features requiring APIs or database to future phases** (auth, forms, dynamic data, etc.)

## Blog/News Site

User wants: Release notes blog with post listing and detail pages

**Initial Preview Todo List (single page only):**

- Build homepage (index.tsx) with site title and list of 3-4 release note cards
- Add post cover images for homepage
- Update header and footer in App.tsx
- Ask user if they want to build: individual post detail pages

**Deferred to future phase:** Post detail pages

Handoff to: **develop agent**

## Dashboard

User wants: Analytics dashboard

**Initial Preview Todo List (single page only):**

- Create dashboard homepage (index.tsx) with stats cards and activity feed
- Ask user if they want to add: settings page, reports page

**Deferred to future phase:** Settings page, reports page

Handoff to: **develop agent**

## Portfolio

User wants: Personal portfolio with projects

**Initial Preview Todo List (single page only):**

- Build homepage (index.tsx) with about section and project grid (cards only)
- Add project preview images
- Update header and footer in App.tsx
- Ask user if they want to build: individual project detail pages, contact page

**Deferred to future phase:** Project detail pages, contact page

Handoff to: **develop agent**

## Multi-Page Website

User wants: Business website with home, about, services, and contact pages

**Initial Preview Todo List (single page only):**

- Build homepage (index.tsx) with company intro and service highlights
- Add hero image for homepage
- Update header and footer in App.tsx
- Ask user if they want to build: about page, services page, contact page

**Deferred to future phase:** About page, services page, contact page

Handoff to: **develop agent**

## App with API/Database Features

User wants: Task management app with user accounts and task storage

**Initial Preview Todo List (single page only):**

- Build homepage (index.tsx) with task list UI (static mock data)
- Ask user if they want to build: user authentication, database integration, task persistence

**Deferred to future phase:** User authentication, database setup, API endpoints, real data persistence

**Note:** Initial preview uses mock/static data to demonstrate the UI without backend.

Handoff to: **develop agent**

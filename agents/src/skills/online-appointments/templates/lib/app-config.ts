import type { ElementType } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// AppConfig — all user-facing text, icons, and feature flags for the UI.
//
// Override any field by wrapping the app in <AppConfigProvider config={...}>.
// Every field has a sensible default so partial overrides work naturally.
// ─────────────────────────────────────────────────────────────────────────────

export interface BrandConfig {
  /** Business / app name shown in nav, auth pages, and page titles. */
  name: string;
  /** Short tagline shown beneath the name in auth shells. */
  tagline: string;
  /** Lucide (or any React) icon component for the brand mark. Pass null to hide. */
  icon: ElementType | null;
}

export interface BookingConfig {
  /** Title shown above the service grid. */
  pageTitle: string;
  /** Subtitle beneath the page title. */
  pageSubtitle: string;
  /** Label on the "back to services" navigation link. */
  backToServicesLabel: string;
  /** Primary CTA label on the details form submit button. */
  submitLabel: string;
  /** Labels for the wizard steps (order must match BookingStep union). */
  steps: [string, string, string, string];
  /** Success screen title after booking is confirmed. */
  confirmationTitle: string;
  /** Success screen body text. */
  confirmationDescription: string;
}

export interface HomeConfig {
  /** Hero section heading. */
  heroTitle: string;
  /** Hero section sub-heading. */
  heroDescription: string;
  /** Primary CTA button label in the hero. */
  heroCta: string;
  /** Whether to render the "How it works" section. */
  showHowItWorks: boolean;
  /** Whether to render the feature-grid section. */
  showFeatures: boolean;
  /** Whether to render the "Who is this for?" user-journey section. */
  showUserJourneys: boolean;
  /** Footer CTA heading. */
  footerCtaTitle: string;
  /** Footer CTA description. */
  footerCtaDescription: string;
  /** Footer CTA button label. */
  footerCtaLabel: string;
}

export interface AdminConfig {
  /** Admin dashboard page heading. */
  dashboardTitle: string;
  /** Admin dashboard page sub-heading. */
  dashboardSubtitle: string;
  /** Admin login page heading. */
  loginTitle: string;
  /** Admin login page description. */
  loginDescription: string;
}

export interface AppConfig {
  brand: BrandConfig;
  booking: BookingConfig;
  home: HomeConfig;
  admin: AdminConfig;
  /** ISO 4217 currency code used for all price formatting. Loaded from business settings. */
  currency: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults — mirrors every hardcoded string in the codebase.
// ─────────────────────────────────────────────────────────────────────────────

export const defaultAppConfig: AppConfig = {
  brand: {
    name: "Appointments",
    tagline: "Book and manage your appointments in one place.",
    icon: null,
  },
  booking: {
    pageTitle: "Choose a service",
    pageSubtitle: "Select what you'd like to book.",
    backToServicesLabel: "All services",
    submitLabel: "Confirm booking",
    steps: ["Date", "Time", "Details", "Confirm"],
    confirmationTitle: "You're booked!",
    confirmationDescription: "A confirmation will be sent to your email.",
  },
  home: {
    heroTitle: "Book your appointment in seconds",
    heroDescription:
      "Real-time availability, instant confirmation, and simple management — for both clients and businesses.",
    heroCta: "Book an appointment",
    showHowItWorks: true,
    showFeatures: true,
    showUserJourneys: true,
    footerCtaTitle: "Ready to get started?",
    footerCtaDescription: "Book your first appointment in under a minute.",
    footerCtaLabel: "Book now",
  },
  admin: {
    dashboardTitle: "Dashboard",
    dashboardSubtitle: "Overview of your appointment business",
    loginTitle: "Admin sign in",
    loginDescription: "Access the dashboard with your admin account.",
  },
  currency: "USD",
};

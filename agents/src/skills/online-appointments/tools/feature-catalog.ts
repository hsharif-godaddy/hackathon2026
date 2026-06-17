/**
 * Online Appointments — feature catalog (single source of truth).
 *
 * This file enumerates the OPTIONAL, extensible capabilities of the
 * online-appointments skill — the booking core itself is always installed and is
 * therefore not listed here. Two suggestion behaviours read from this catalog:
 *
 *   1. "Pending tasks" — capabilities the customer has NOT built yet, offered as
 *      next steps at the end of a build turn (behaviour 1).
 *   2. "What's new" — capabilities added since the customer last saw suggestions,
 *      offered when a customer returns after a while (behaviour 2).
 *
 * Per the skills Self-Containment Rule (see agents/src/skills/README.md), all of
 * this data and detection logic lives inside the skill. Nothing outside this
 * directory is keyed by the skill name. To add a capability, append an entry here
 * and bump OLA_CATALOG_VERSION — no agent-core or prompt-builder changes required.
 * That is the Open/Closed seam: the skill is open for extension, the agent core is
 * closed for modification.
 *
 * This module is intentionally free of database/logging imports so the detection
 * and diff logic can be unit-tested against a temp directory. The DB-resolving
 * tool wrapper lives in ./index.ts.
 */

import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Monotonic catalog version. Bump by 1 whenever a NEW feature is added below, and
 * set the new feature's `addedInVersion` to this value. Returning customers whose
 * stored "last seen" version is lower will be shown the delta.
 */
export const OLA_CATALOG_VERSION = 2;

/**
 * How to detect whether a feature is already installed in the customer's app.
 *
 * A feature counts as installed when ANY of `files` exists. When `markers` is
 * provided, a matching file must additionally contain at least one marker string
 * — used for features whose presence is a CONFIG VALUE inside an always-present
 * file (e.g. `pricingTiers` inside the appointments config) rather than a file of
 * their own.
 */
export interface FeatureDetection {
  /** App-root-relative candidate paths. Installed if any exists (and, if `markers`, matches). */
  files: string[];
  /** Optional substrings; a candidate file must contain one of these to count as installed. */
  markers?: string[];
}

export interface OlaFeature {
  /** Stable identifier, also used as the suggestion metadata key. */
  id: string;
  /** Short, plain-English suggestion text suitable for a clickable button. */
  label: string;
  /** One-line description the agent can expand on; never shown raw to non-technical users. */
  summary: string;
  /** Catalog version in which this capability first shipped. */
  addedInVersion: number;
  /** Filesystem signal used to decide whether it is already built. */
  detect: FeatureDetection;
}

const CONFIG_PATH = 'src/lib/appointments.config.ts';
const BOOKING_POST_PATH = 'src/server/api/appointments/POST.ts';

/**
 * The optional capabilities of the online-appointments skill. Keep `summary`
 * wording aligned with the matching `templates/sections/NN-*.md` step.
 */
export const OLA_FEATURE_CATALOG: readonly OlaFeature[] = [
  {
    id: 'paid-booking',
    label: 'Charge customers when they book',
    summary:
      'Take payment at booking time via GoDaddy Commerce — a single price or multiple tiers (§8 Payment Integration).',
    addedInVersion: 1,
    detect: { files: [CONFIG_PATH], markers: ['pricingTiers'] },
  },
  {
    id: 'email-confirmations',
    label: 'Send booking confirmation emails',
    summary:
      'Email each customer a confirmation with a calendar (.ics) invite after they book (§9 Email Notifications).',
    addedInVersion: 1,
    detect: {
      // Email confirmations are built one of two ways and detection must cover
      // BOTH, or a built feature is never detected and wrongly keeps resurfacing
      // as a pending suggestion:
      //   • §9 split files — calendar-invite.ts (the .ics generator) +
      //     appointment-email.ts (the nodemailer transport), or
      //   • inlined into the booking handler — the markers land in POST.ts.
      // POST.ts is part of the always-installed booking core, so it only matches
      // when an email/ICS marker is actually present there (the shipped core has
      // none) — no false positive.
      files: [
        'src/server/utils/appointment-email.ts',
        'src/lib/calendar-invite.ts',
        BOOKING_POST_PATH,
      ],
      markers: ['nodemailer', 'BEGIN:VCALENDAR', 'sendConfirmationEmail'],
    },
  },
  {
    id: 'admin-dashboard',
    label: 'Add an owner dashboard',
    summary:
      'A private page for the business owner to view and manage incoming appointments (§10 Admin Dashboard).',
    addedInVersion: 1,
    detect: {
      // §10 ships both the admin API route (§10.1) and the dashboard page (§10.2);
      // either is a reliable signal, so detect on both. The page is built one of a
      // few ways depending on layout, so the legacy page paths are kept as fallbacks.
      files: [
        'src/server/api/admin/appointments/[id]/PATCH.ts',
        'src/pages/AdminDashboard.tsx',
        'src/pages/admin/Appointments.tsx',
        'src/pages/Admin.tsx',
      ],
    },
  },
  {
    id: 'customer-portal',
    label: 'Add a customer portal',
    summary:
      'Let customers sign in to view, reschedule, or cancel their own appointments (§11 Customer Portal).',
    addedInVersion: 1,
    detect: {
      // §11 builds the portal page at src/pages/Account.tsx and a portal-only
      // credits API at src/server/api/account/credits/GET.ts. Either is a reliable
      // signal: nothing in the base app template or other skills ships these files,
      // so there is no false positive, and detecting via file existence means a
      // built portal correctly drops out of "pending". The legacy MyAppointments /
      // account-Appointments paths are kept as fallbacks for alternate layouts.
      files: [
        'src/pages/Account.tsx',
        'src/server/api/account/credits/GET.ts',
        'src/pages/MyAppointments.tsx',
        'src/pages/account/Appointments.tsx',
      ],
    },
  },
  {
    id: 'class-credits',
    label: 'Sell class packs and credits',
    summary:
      'Let customers buy credit packs up front and spend one credit per booking (§12 Class Credits System).',
    addedInVersion: 2,
    detect: { files: [CONFIG_PATH], markers: ['classPackages'] },
  }
];

/** Capabilities NOT present in the app — the pending next steps (behaviour 1). */
export function computePending(
  installedIds: ReadonlySet<string>,
  catalog: readonly OlaFeature[] = OLA_FEATURE_CATALOG,
): OlaFeature[] {
  return catalog.filter((feature) => !installedIds.has(feature.id));
}

/**
 * Capabilities added since the customer last saw suggestions (behaviour 2).
 * A missing/zero `lastSeenVersion` means "never seen" → everything is new.
 */
export function computeNewSinceLastSeen(
  lastSeenVersion: number,
  catalog: readonly OlaFeature[] = OLA_FEATURE_CATALOG,
): OlaFeature[] {
  return catalog.filter((feature) => feature.addedInVersion > lastSeenVersion);
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/** True when the feature's filesystem signal is present under `appPath`. */
export async function isFeatureInstalled(
  appPath: string,
  feature: OlaFeature,
): Promise<boolean> {
  const { files, markers } = feature.detect;
  for (const relativePath of files) {
    const absolutePath = join(appPath, relativePath);
    if (!(await pathExists(absolutePath))) {
      continue;
    }
    if (!markers || markers.length === 0) {
      return true;
    }
    try {
      const content = await readFile(absolutePath, 'utf8');
      if (markers.some((marker) => content.includes(marker))) {
        return true;
      }
    } catch {
      // Unreadable file: treat as not matching and keep checking candidates.
    }
  }
  return false;
}

/**
 * Files the booking core installs. Used to decide whether this skill has any
 * footprint in the app at all — the gate for proactive "what's new" suggestions
 * (a brand-new site with no booking system gets nothing).
 */
const CORE_FOOTPRINT_FILES = ['src/lib/appointments.ts', 'src/lib/appointments.config.ts'];

/** True when a booking system has been installed in this app. */
export async function hasBookingFootprint(appPath: string): Promise<boolean> {
  for (const relativePath of CORE_FOOTPRINT_FILES) {
    if (await pathExists(join(appPath, relativePath))) {
      return true;
    }
  }
  return false;
}

/** Resolve the set of installed feature ids by inspecting the app filesystem. */
export async function detectInstalled(
  appPath: string,
  catalog: readonly OlaFeature[] = OLA_FEATURE_CATALOG,
): Promise<Set<string>> {
  const results = await Promise.all(
    catalog.map(async (feature): Promise<string | null> =>
      (await isFeatureInstalled(appPath, feature)) ? feature.id : null,
    ),
  );
  return new Set(results.filter((id): id is string => id !== null));
}

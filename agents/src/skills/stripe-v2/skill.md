---
name: stripe-v2
description: Add Stripe payment integration to the customer's app via the platform-managed flow — Airo provisions a dedicated Stripe sandbox for the app, the user claims it, and the customer app gets sandbox keys delivered automatically.
whenToUse: User explicitly mentions Stripe for payments. Phrases like "add Stripe", "Stripe checkout", "Stripe payments", "Stripe subscription". Only use this skill when the user specifically asks for Stripe — for general e-commerce requests, use the commerce skill instead.
enablementId: stripe-v2
---

# Stripe Integration (`stripe-v2`)

This skill is the Airo platform-managed Stripe flow. When the user asks to add Stripe, Airo provisions a dedicated Stripe **claimable sandbox** account for the app via `stripe-service`. The sandbox's test-mode keys flow into the customer-app runtime, so checkout/subscription code in the customer app can run against a real Stripe sandbox immediately — no manual key-paste required from the user.

## Two-call flow

1. **`stripe-v2__setup`** — provisions a Stripe sandbox for this app (or returns the existing one). Returns `sandboxId`, `accountId`, and `claimUrl`.
2. **`stripe-v2__status`** — reads the current state. Status advances `provisioned` → `claimed` (after the user clicks the claim URL) → `live` (once they convert to a real Stripe account).

Both tools are read-mostly: setup is server-side idempotent on `appId` (re-running returns the same sandbox + same claim URL — never creates duplicates), and status is a pure read.

## What `stripe-v2__setup` returns and how to talk about it

**The sandbox is immediately usable for testing.** The test-mode keys (`sk_test_*`, `pk_test_*`, `ek_test_*`) returned by Stripe's `claimableSandboxes.create` power the full Stripe API surface — Hosted Checkout, Embedded Checkout, Elements, products/prices, subscriptions — in **test mode**. End-to-end purchase flows work against Stripe's test card numbers (e.g. `4242 4242 4242 4242`) without the user touching the claim URL.

**The `claimUrl` is for going live, not for unlocking testing.** It opens Stripe's hosted claim flow where the user takes ownership of the sandbox and can later convert it to live (real-money) mode. Until they want to accept real payments from real customers, they don't need to click it.

**Do NOT sequence the next step as "claim first, then I'll integrate."** That mischaracterizes Stripe's flow and makes the user think they have to take an external action before they can build or test anything. Treat the sandbox as ready to use; treat the claim URL as a save-for-later breadcrumb.

Sample framing for the chat reply:

> ✅ Your Stripe sandbox is ready. You can build and test payment flows with Stripe's test cards (e.g. `4242 4242 4242 4242`) right now.
> 📌 Save this URL for when you're ready to take real payments — you'll claim the sandbox here: \<claimUrl>
> Want me to start setting up checkout, products, and pricing now?

## Idempotency and reuse

- **`stripe-v2__setup` is safe to call repeatedly.** `stripe-service` looks up the app's existing sandbox before calling Stripe; if one exists, it returns the cached sandbox without creating a new one. Use this if the user lost the claim URL — re-running setup gives them the same `claimUrl` again.
- **`stripe-v2__status` is read-only and idempotent.** Safe to call any time, returns `{hasStripe: false}` if no sandbox yet.

## Graceful degradation

If `stripe-v2__setup` returns `{stripeProvisioningUnavailable: true, message}`, the upstream Stripe API has rejected the request — usually because the v2 preview API isn't enabled for this Airo Builder deployment yet. Tell the user the literal `message`. Don't retry within the same conversation; suggest they try again later. This is the expected state until the platform Stripe access is fully wired up.

## Current scope

This skill covers **sandbox provisioning and claim-status reads** only. It does not yet render checkout pages, install the `stripe` npm package, or copy checkout templates into the customer app — that integration is coming. If the user asks for checkout pages now, acknowledge that the sandbox is ready and tell them the checkout UI integration is on the way.

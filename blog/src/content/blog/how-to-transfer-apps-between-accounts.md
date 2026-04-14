---
title: "How to Transfer Apps Between Accounts | Airo AI Builder Guide"
description: "Learn how to transfer apps between accounts in Airo AI Builder. Step-by-step guide for freelancers, agencies, and teams handing off apps to clients or collaborators. No data lost, no rebuilding."
pubDate: 2026-04-14
category: "How-To"
heroImage: "/images/app-transfer-hero.png"
---

## Built an App for Someone Else? Here's How to Hand It Off Without the Headache.

If you've ever built an app for a client, a partner, or a different team and then had to figure out how to actually get it into their hands, you know the pain. Exporting code, re-uploading files, recreating database configurations, and hoping nothing breaks in the process.

Airo AI Builder now has a built-in app transfer feature that lets you move a full app from one account to another in under a minute. Your data, files, and stored secrets all carry over. No exporting, no rebuilding, no crossing your fingers.

This guide walks through how app transfers work, when to use them, and what to expect on both sides of the handoff.

---

## Video Walkthrough

Watch the full step-by-step walkthrough of app transfers in Airo AI Builder:

<iframe width="100%" style="aspect-ratio: 16/9;" src="https://www.youtube.com/embed/s_u-NBkg7SM" title="App Transfer Walkthrough" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

---

## Who Is This For?

App transfers solve a specific problem: getting a finished (or in-progress) app from one Airo AI Builder account to another. That comes up more often than you'd think.

- **Freelancers and agencies** building apps for clients who need to own and manage them long-term
- **Teams** where one person prototypes and another takes over for production
- **Anyone with multiple accounts** who wants to consolidate or reorganize projects
- **Collaborators** working together on a project across separate accounts

If you've ever copied code between accounts, emailed files back and forth, or rebuilt something from scratch because there was no clean way to move it, this feature replaces all of that.

---

## What Transfers With the App

When you transfer an app, it's not just the front end. The full package moves:

- **App code and UI** — Everything the builder generated, including pages, components, and layouts
- **Database and data** — Your database schema and stored data carry over
- **Files and assets** — Images, uploads, and other files included in the app
- **Stored secrets** — API keys and environment variables transfer securely, so backend integrations stay intact

This means the recipient gets a working app, not a pile of parts to reassemble.

---

## What Changes After Transfer

A few things shift when the app moves to a new account. None of them are deal-breakers, but it helps to know upfront.

- **The app gets unpublished** from the sender's account. It's no longer live under your domain.
- **Custom domains disconnect.** The recipient will need to connect their own domain or use a new subdomain.
- **The recipient needs to republish.** The app lands in their account in an unpublished state. One click to go live again.
- **Stored secrets stay intact.** Backend integrations (Stripe keys, API tokens, etc.) don't break. The recipient can update them if needed.

Think of it like handing someone the keys to a car that's been turned off. Everything's still there; they just need to start it up.

---

## How to Transfer an App: Step by Step

The full process takes about a minute from start to finish.

### Step 1: Start the transfer

Go to your **My Apps** page. Find the app you want to transfer, click the **three-dot menu**, and select **Transfer**.

A modal appears with a summary of what will happen during the transfer.

### Step 2: Review what happens

Before confirming, you'll see a recap:

- The app will be unpublished from your account
- Connected domains will be disconnected
- Stored secrets will transfer with the app
- The recipient will need to republish

This is your checkpoint. If the app is currently live and serving users, coordinate with the recipient so there's minimal downtime.

### Step 3: Enter the recipient's email

Type in the email address associated with the recipient's Airo AI Builder account. They need to have an account before you can initiate the transfer.

### Step 4: Share the transfer code

After confirming, you'll get a **unique transfer code**. Copy it and send it to the recipient through whatever channel works: email, Slack, text, Discord.

One important detail: the code **expires in 72 hours**. If the recipient doesn't accept within that window, you'll need to generate a new one.

### Step 5: Recipient accepts the transfer

On the recipient's side, they go to their **My Apps** page, click the **three-dot menu**, and select **Accept Transfer**. They paste in the code, confirm, and the app appears in their account within seconds.

That's it. Five steps, one minute, done.

---

## Tips for a Smooth Transfer

A few things that make the handoff even cleaner:

**Coordinate timing.** If the app is live, let the recipient know they'll need to republish. Plan for a short gap if the app is serving real users.

**Update secrets if needed.** Stored secrets (API keys, tokens) transfer with the app, which keeps things working. But if the recipient should use their own keys (e.g., their own Stripe account), they can swap them out after accepting.

**Share context, not just the app.** The transfer moves the technical artifact. Consider also sharing notes on how the app is structured, any prompts you used to build key features, and login credentials for connected services.

**Use the 72-hour window wisely.** Send the transfer code and a heads-up message at the same time so the recipient knows to act on it.

---

## Common Questions

**Can I transfer an app that's currently published?**
Yes. The app will be unpublished from your account as part of the transfer. The recipient can republish it from their end.

**What if the transfer code expires?**
You'll need to start the process again and generate a new code. The app stays in your account until a transfer is successfully accepted.

**Does the recipient need a paid plan?**
They need an Airo AI Builder account. If the app uses features that require a paid plan, they'll need the appropriate plan to republish and run it.

**Can I transfer multiple apps at once?**
Transfers are one app at a time. If you need to move several, repeat the process for each.

**Can I undo a transfer?**
Once the recipient accepts, the app is in their account. To get it back, they'd need to transfer it back to you using the same process.

---

## Try It Out

App transfers are available now in [Airo AI Builder](https://airo-builder.godaddy.com?referralId=DamWZ-ryeCH7). If you're building for clients, teams, or managing multiple accounts, it removes one of the most annoying parts of the workflow.

App transfer is available in Premium and Ultimate plans only.

Questions or feedback? Join the [Airo AI Builder community on Discord](https://discord.gg/EfybfxAXg8) and let us know how you're using transfers.

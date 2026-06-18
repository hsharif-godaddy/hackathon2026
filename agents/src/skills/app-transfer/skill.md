---
name: app-transfer
description: Move an app to another account (transfer ownership between GoDaddy accounts)
whenToUse: >-
  User wants to move/transfer an app to another account or owner — "transfer my
  app", "move app to my client", "give my app to someone", "change app owner",
  "accept a transfer", "transfer code". ALSO load for explanatory questions
  about how transfer works, what moves, or its effects, even with no action verb.
intents:
  - transfer app/move app to another account/give app to client/change app owner/accept transfer/transfer code/transfer ownership
---

# Transferring Apps Between Accounts

App transfer moves a complete app from one GoDaddy account to another — no code export or file recreation. It is a self-service flow the user runs in the **My Apps** dashboard, outside this chat.

<how_to_respond>
There is no transfer tool, so guide the user through the My Apps steps below rather than attempting the transfer yourself. Tailor the answer to what they asked — sending, accepting, eligibility, or what happens to their data. Always surface the two effects people are most likely to be caught out by: the app is **unpublished** in the original account and any **custom domain disconnects**, so the recipient must republish and reconnect the domain. State the **Premium/Ultimate** requirement whenever the user is the one sending, and note that apps with a **GoDaddy Commerce** integration can't be transferred. If someone regrets a transfer they already started, point them to **Cancel Transfer** on the app's pending card — it works until the recipient accepts.
</how_to_respond>

## Who can transfer

- **Sending** an app requires a **Premium or Ultimate plan** — the gate is on the account initiating the transfer.
- The **recipient** only needs an **active GoDaddy account** linked to the email the transfer is sent to (no paid plan required to receive).
- Apps transfer **one at a time**.
- Apps with a **GoDaddy Commerce** integration **cannot be transferred** — the option is blocked for them.

## What moves

The whole app package goes to the recipient: app code and UI (pages, components, layouts), database schema and existing data, images/uploads, and API keys + environment variables — transferred securely, so backend integrations keep working.

## What changes after transfer

- The app becomes **unpublished** in the original account.
- Custom domains **disconnect** from the original setup.
- The recipient must **republish** to make it live again (and reconnect any custom domain).
- Stored secrets remain functional after the move.

## Steps

**Sender:** My Apps → find the app → three-dot menu → **Transfer** → review the summary (confirms unpublish + domain disconnect) → enter the recipient's **GoDaddy email** → copy the **transfer code** and share it with them.

**Recipient:** My Apps → **Accept Transfer** → enter the **transfer code** → confirm.

## Limitations

- The transfer code **expires in 72 hours**.
- One app can be transferred at a time.
- A **pending** transfer (sent but not yet accepted) can be **cancelled** by the sender from **My Apps** — open the app's pending card and choose **Cancel Transfer**, which voids the code.
- Once a transfer is **accepted** it **cannot be reversed**; undoing it means the new owner transfers the app back.

<example>
User: Can I move my app to my client's account?
You: Yes — on a Premium or Ultimate plan you can transfer an app from **My Apps**: open the app's three-dot menu, choose **Transfer**, enter your client's **GoDaddy email**, and share the transfer code with them (it expires in 72 hours). They accept it from **My Apps → Accept Transfer**. One heads-up — the app becomes unpublished and any custom domain disconnects, so they'll need to republish and reconnect the domain. The code, data, files, and secrets all come across.
</example>

<example>
User: Someone is sending me their app — how do I accept it?
You: Ask them for the transfer code they got when they started the transfer; it's valid for 72 hours. Then go to **My Apps → Accept Transfer**, enter the code, and confirm. You'll need an active GoDaddy account on the email they sent it to. The app arrives unpublished, so publish it to take it live and reconnect a custom domain if you want one.
</example>

<example>
User: If I transfer my app, do I lose my database and API keys?
You: No — the full package moves with it: pages and components, the database schema and its data, uploaded files, and your API keys and environment variables (transferred securely, so integrations keep working). What changes is publishing — the app is unpublished in your account and custom domains disconnect, so the new owner republishes and reconnects the domain.
</example>

<example>
User: I started a transfer by mistake — can I undo it?
You: If the recipient hasn't accepted yet, yes — go to **My Apps**, find the app (it shows a transfer-pending state), and choose **Cancel Transfer**. That voids the code so it can't be used. Once they've accepted, it can't be reversed; they'd have to transfer the app back to you.
</example>

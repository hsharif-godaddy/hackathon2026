---
name: callmebot
description: Add CallMeBot WhatsApp notifications to an app. Load when user mentions CallMeBot by name.
whenToUse: User mentions CallMeBot. Phrases like "set up CallMeBot", "add CallMeBot", "use CallMeBot".
intents:
  - CallMeBot
---

# CallMeBot WhatsApp API

**Purpose:** Send free WhatsApp messages to yourself via a simple HTTP GET request. Personal use only.

---

## Setup (User Must Do This First)

The user needs an API key before the app can send messages:

1. **Add the bot phone number to contacts:** `+34 611 08 28 80`
2. **Send this exact WhatsApp message** to that number: `I allow callmebot to send me messages`
3. **Wait for the reply** containing their API key (arrives within 2 minutes; if not, retry after 24 hours)

---

## Collect credentials via `requestSecrets`

The phone number and API key are user-specific. Collect both with `requestSecrets` and read them from `process.env` — **never hardcode them, never use the example values, and never carry a number the user typed in chat into the form or code.** The user enters the number directly into the form so it cannot be mistyped or invented.

```typescript
requestSecrets({
  title: 'CallMeBot WhatsApp credentials',
  description: 'Sends WhatsApp notifications to your own number. Complete the CallMeBot setup first.',
  secrets: [
    {
      name: 'CALLMEBOT_PHONE_NUMBER',
      description: 'Your WhatsApp number with country code, no + (e.g. 15551234567)',
      required: true,
    },
    { name: 'CALLMEBOT_API_KEY', description: 'The API key CallMeBot replied with during setup', required: true },
  ],
  mode: 'add',
});
```

---

## API Usage

```
https://api.callmebot.com/whatsapp.php?phone=[phone]&text=[message]&apikey=[apikey]
```

| Parameter | Value |
|-----------|-------|
| `phone` | `process.env.CALLMEBOT_PHONE_NUMBER` — country code, without `+` |
| `text` | URL-encoded message (`%20` for space, `%0A` for newline) |
| `apikey` | `process.env.CALLMEBOT_API_KEY` |

Read both from `process.env` at runtime and early-return if either is unset (never send to an unknown number). WhatsApp formatting (`*bold*`, `_italic_`) is supported. Personal use only — cannot send to other numbers or groups; for that see https://textmebot.com (paid) or https://www.twilio.com.

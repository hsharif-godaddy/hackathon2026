# VERIFY Phase

**After the user approves the plan — BEFORE generating — verify prerequisites and figure out what (if anything) the customer still needs to do. Two kinds:**
- **Agent can do it automatically** → just do it, don't ask the customer (e.g. setting up the blog system).
- **Only the customer can do it** → don't block generation, but RECORD it as a pending action and call it out clearly in SUMMARY by the Launch button (e.g. connecting social accounts).

## Step 1: Check social platform connections (if social posts are in the plan)

```javascript
socialRead({ platform: 'FACEBOOK' })
socialRead({ platform: 'INSTAGRAM' })
```

If no social connections exist AND social posts are in the plan, this is a **CUSTOMER action** (the agent cannot do it):
- There is NO agent tool to connect accounts — connecting is a user-driven flow in the app UI. Do NOT attempt to call a connect tool.
- Do NOT block generation — the social posts are still created and saved as publishable widgets.
- RECORD it as a PENDING CUSTOMER ACTION and surface it prominently in SUMMARY, right by the Launch button — e.g. *"Before launch: connect Facebook/Instagram so your social posts can publish."* Never let the summary imply social will auto-publish when it isn't connected.

## Step 2: Check blog section exists (if blog posts are in the plan)

```javascript
directoryListing({ path: 'src/content/blog' })
```

This is something the AGENT sets up automatically — it is NOT a customer action. If the blog system doesn't exist yet, the GENERATE handoff brief SETS IT UP (blog listing page + route) and then creates the posts (see `04-generate.md`). Never ask the customer to set up a blog — just do it.

## Step 3: Proceed to GENERATE

Once you've checked prerequisites — auto-handling the agent-doable ones (blog system) and recording the customer-only ones (social connection) — proceed directly to GENERATE. Do NOT ask for another confirmation (the plan was already approved). Carry the list of pending customer actions into SUMMARY so they're called out by the Launch button.

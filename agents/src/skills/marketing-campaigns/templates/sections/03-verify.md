# VERIFY Phase

**After the user approves the plan, verify prerequisites BEFORE generating content.**

## Step 1: Check social platform connections (if social posts are in the plan)

```javascript
socialRead({ platform: 'FACEBOOK' })
socialRead({ platform: 'INSTAGRAM' })
```

If no social connections exist AND social posts are in the plan:
- Inform the user: "To publish social posts, you'll need to connect your social accounts."
- Call `socialConnect({ platform: 'FACEBOOK' })` to start the connection flow
- Wait for the user to complete the connection before proceeding

## Step 2: Check blog section exists (if blog posts are in the plan)

```javascript
directoryListing({ path: 'src/content/blog' })
```

If the blog directory doesn't exist, it will be created during the handoff to DevelopAgent — no action needed from the user, just note it.

## Step 3: Proceed to GENERATE

Once prerequisites are met (or if none are missing), proceed directly to GENERATE. Do NOT ask for another confirmation — the plan was already approved.

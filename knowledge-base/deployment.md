# Deployment & Publishing

## Current Status

**Publishing and deployment features are now available!**

## Publishing Sites with the publishClient Tool

**You can now publish sites directly using the `publishClient` tool!**

### When to Publish

Use the `publishClient` tool when users request to:

- "Publish my site"
- "Deploy to production"
- "Make my app live"
- "Push to production"
- "Deploy my changes"

### How to Publish

```typescript
// Simply use the publishClient tool - no arguments needed!
{
  "name": "publishClient",
  "arguments": {}
}
```

**Note:** You don't need to provide a commit hash - the tool automatically publishes the current HEAD commit.

### What Happens When You Publish

1. **Build Verification** - The app is built and verified
2. **Archive Creation** - A production archive is created with only the built artifacts (dist/ folder)
3. **Deployment** - The site is deployed to production
4. **Response** - You'll receive deployment ID and status

### Publishing Workflow

**Before Publishing:**

- Ensure the app builds successfully
- Verify all changes are committed
- Make sure tests pass (if applicable)

**After Publishing:**

- Inform the user the deployment has started
- Provide the deployment ID if available
- Let them know they can monitor progress in the History tab
- Remind them they can configure the domain in settings

### Important Notes

- Publishing requires user authentication (handled automatically)
- The process can take 1-2 minutes
- Users will receive updates about deployment progress
- Only committed changes are published

### Example Interactions

**User:** "publish my site"
**You:** _Use publishClient tool_ → "Successfully published! Deployment [ID] is now live. You can monitor the progress in the History tab."

**User:** "can you deploy this to production?"
**You:** _Use publishClient tool_ → "Done! Your site has been deployed to production. The deployment is processing and will be live shortly."

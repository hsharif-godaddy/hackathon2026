# Image Security

## Problem
External web image URLs pose licensing/compliance risks.

## Solution
Added guardrail in `agents/src/prompts/shared/security.md`:
- **Block** external stock web image URLs
- **Allow only** media tool (Getty Images) or AI-generated images

## Testing Results
Tested 7-8 websites with these approaches:

1. **Disabled media tool** - When media tool was disabled to prevent Getty stock images, it generated AI images instead of fetching pre-trained stock images from the web.

2. **Asked to web search for images** - Explicitly asked to do web search and get images directly from the web if media tools failed.

3. **Result** - Requesting stock images directly from web gets blocked by security guardrails. Falls back to media tool, or generates AI images if that fails.

✅ No external/pre-trained web images were used in any test case.

For reference I have attached images in this PR description: https://github.com/gdcorp-partners/airo-app-builder/pull/1229
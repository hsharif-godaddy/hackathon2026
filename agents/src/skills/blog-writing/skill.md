---
name: blog-writing
description: Create blog post content for sites with blog system installed
---

# Blog Writing Skill

**Purpose:** Create blog post content for sites that already have a blog system installed.

> **Note:** This skill provides instructions for blog content creation. Some skills may also provide specialized tools that are automatically loaded when you activate the skill. Tools are prefixed with the skill name (e.g., `skillname__toolname`) to prevent naming conflicts. You can unload a skill's tools with `skill({ action: 'unload', skill: 'name' })` when no longer needed.

---

## CRITICAL FIELD NAMES - MUST BE EXACT

**These field names are REQUIRED by the BlogPost TypeScript interface:**

**CORRECT:**

```yaml
publishedAt: '2024-12-08T10:00:00Z' # ISO 8601 with time
featuredImage: 'https://media.gettyimages.com/id/...'
```

**FORBIDDEN (WILL CAUSE ERRORS):**

```yaml
date: '2024-12-08' # Causes "Invalid Date"
published_at: '2024-12-08' # Not recognized
coverImage: 'https://...' # Image won't show
image: 'https://...' # Not recognized
featured_image: 'https://...' # Not recognized
```

---

## When to Use This Skill

**User says:**

- "Write a blog post about [topic]"
- "Create a blog post about [topic]"
- "Add 3 blog posts"
- "Write blog content"

**Prerequisites:**

- Blog system must already be activated (blog routes, pages, components exist)
- User is explicitly asking for blog content, not blog setup

---

## Step-by-Step: Creating Blog Posts

### Prerequisites: Determine Publish Date

**IMPORTANT: Check the system prompt for today's current date before setting publish dates.**

**The blog system supports scheduling posts for future publication.**

**Timezone Handling:**

All publish dates must be in UTC (ISO 8601 format with 'Z' suffix). When handling scheduling:

**IMPORTANT: Check the system prompt for the user's detected timezone FIRST.**

The system prompt may include `User's timezone: [IANA timezone]` (e.g., "America/Phoenix", "America/New_York", "Europe/London"). If the timezone is present, use it automatically for conversions. Only ask for timezone if not present in the system prompt.

1. **If user specifies a specific TIME** (e.g., "8 PM", "3:00 PM tomorrow", "noon on Friday"):
   - **CHECK system prompt for timezone**: Look for `User's timezone:` in the system prompt
   - **If timezone IS present**: Use it automatically to convert to UTC
   - **If timezone NOT present**: Ask contextually: "8 PM in what timezone?" or "3:00 PM in which timezone?"
   - **Convert to UTC**: Calculate offset and convert
   - **Example**: "8 PM PST" → 8 PM + 8 hours = 4 AM UTC next day → `2024-12-16T04:00:00Z`
   - **Common conversions**:
     - PST/PDT (UTC-8/-7): Add 8/7 hours
     - EST/EDT (UTC-5/-4): Add 5/4 hours
     - CST/CDT (UTC-6/-5): Add 6/5 hours
     - MST/MDT (UTC-7/-6): Add 7/6 hours

2. **If user specifies only a DATE** (e.g., "next Monday", "December 20"):
   - **Use midnight UTC**: `2024-12-20T00:00:00Z`
   - **No need to ask timezone**: Date-only scheduling uses start of day UTC

3. **If user says "now" or "immediately"**:
   - **Use current date/time from system prompt**: Convert to UTC ISO 8601 format

**Immediate publication:**

```yaml
publishedAt: '2024-12-15T10:00:00Z' # Current or past date in UTC
```

**Scheduled for future:**

```yaml
publishedAt: '2025-01-15T00:00:00Z' # Future date - post won't appear until this date
```

**How it works:**

- Posts are only visible when `publishedAt` date/time is current or in the past (UTC comparison)
- To schedule a post, simply set `publishedAt` to a future date/time with `published: true`
- Scheduled posts remain hidden until their publish date/time automatically

**CRITICAL:** Always reference the system prompt to get today's actual date. Use that as your baseline for calculating publish dates.

---

## Creating the Post

### Step 1: Find Featured Image (REQUIRED)

**You MUST call mediaSearch FIRST:**

```
mediaSearch({
  query: "specific search terms related to blog topic",
  count: 3
})
```

**Example searches:**

- "woman running outdoors fitness morning"
- "healthy meal prep containers kitchen"
- "business team meeting collaboration"
- "yoga instructor teaching class"

**Pick the best Getty Images URL from results.**

### Step 2: Plan the Post

Based on the user's request and site context:

- Identify topic and angle
- Define target keywords for SEO
- Plan content structure (intro, sections, conclusion)
- Consider audience and tone

### Step 3: Create Markdown File

Create `/src/content/blog/post-slug.md` with this EXACT frontmatter structure:

```markdown
---
title: 'Compelling Post Title (60 chars max for SEO)'
excerpt: 'One-sentence summary that hooks the reader (160 chars max)'
author: '[Author Name or Site Team]'
publishedAt: '2024-12-08T10:00:00Z'
category: 'Category Name'
tags: ['tag1', 'tag2', 'tag3']
featuredImage: 'https://media.gettyimages.com/id/123456/photo/description.jpg'
seoTitle: 'SEO-optimized title (60 chars max)'
seoDescription: 'SEO meta description (160 chars max)'
published: true
---

# [Post Title]

Opening paragraph that immediately hooks the reader...

## First Major Section

Content here...

### Subsection

More detailed content...

## Second Major Section

Continue building value...

## Conclusion

Wrap up with key takeaways and call-to-action...
```

---

## Frontmatter Field Requirements

| Field            | Type    | Required       | Format               | Example                                  | Notes                              |
| ---------------- | ------- | -------------- | -------------------- | ---------------------------------------- | ---------------------------------- | --- |
| `title`          | string  | Yes (Required) | Plain text, 60 chars | `"The Ultimate Guide to..."`             |                                    |
| `excerpt`        | string  | Yes (Required) | 160 chars max        | `"Discover the secrets to..."`           |                                    |
| `author`         | string  | Yes (Required) | Name or team         | `"FitFlow Studio Team"`                  |                                    |
| `publishedAt`    | string  | Yes (Required) | **ISO 8601**         | `'2024-12-08T10:00:00Z'`                 | Use future date to schedule        |
| `category`       | string  | Recommended    | Single category      | `"Fitness Tips"`                         |                                    |
| `tags`           | array   | Recommended    | 3-5 tags             | `['fitness', 'health']`                  |                                    |
| `featuredImage`  | string  | Yes (Required) | **Full Getty URL**   | `'https://media.gettyimages.com/id/...'` |                                    |
| `seoTitle`       | string  | Recommended    | 60 chars             | `"Ultimate Guide                         | Brand"`                            |     |
| `seoDescription` | string  | Recommended    | 160 chars            | `"Learn the top 10..."`                  |                                    |
| `published`      | boolean | Yes (Required) | `true` or `false`    | `true`                                   | Must be `true` for scheduled posts |

---

## Content Writing Guidelines

### Structure

**Every blog post should have:**

1. **Compelling Title** (H1)
   - Clear, specific, benefit-driven
   - Include target keyword
   - 60 characters or less

2. **Opening Hook** (First paragraph)
   - Grab attention immediately
   - State the problem or opportunity
   - Promise value

3. **Main Sections** (H2)
   - Break content into scannable sections
   - Use descriptive headings
   - 3-7 main sections

4. **Subsections** (H3, H4)
   - Further break down complex topics
   - Use numbered or bulleted lists
   - Include examples

5. **Visuals** (Optional inline images)
   - Use markdown image syntax: `![Alt text](url)`
   - Get images via mediaSearch
   - Place strategically throughout content

6. **Conclusion**
   - Summarize key takeaways
   - Include clear call-to-action
   - Link to related content or services

### Writing Style

- **Conversational tone**: Write like you're talking to a friend
- **Second person**: Use "you" to speak directly to reader
- **Active voice**: "You can achieve" not "It can be achieved"
- **Short paragraphs**: 2-4 sentences max
- **Scannable**: Use lists, bold text, and clear headings
- **Valuable**: Every section should provide actionable insight

### SEO Best Practices

- **Primary keyword**: Include in title, first paragraph, 2-3 times naturally
- **Related keywords**: Use variations and semantically related terms
- **Headings**: Include keywords in H2/H3 headings naturally
- **Internal links**: Reference other blog posts or site pages
- **Meta optimization**: Ensure seoTitle and seoDescription are compelling
- **Alt text**: Describe images for accessibility and SEO

### Length Guidelines

- **Minimum**: 800 words (comprehensive but focused)
- **Optimal**: 1,200-2,000 words (in-depth, authoritative)
- **Maximum**: 3,000 words (only for ultimate guides)

---

## Common Mistakes to Avoid

### Wrong Field Names

```yaml
# THESE WILL BREAK THE POST:
date: '2024-12-08' # Wrong - use publishedAt
coverImage: 'url' # Wrong - use featuredImage
published_at: '2024-12-08' # Wrong - use publishedAt (camelCase)
image: 'url' # Wrong - use featuredImage
```

### Wrong Date Format

```yaml
# THESE WILL CAUSE "Invalid Date" ERRORS:
publishedAt: '2024-12-08'           # Missing time component
publishedAt: '12/08/2024'           # Not ISO 8601
publishedAt: 'December 8, 2024'     # Not ISO 8601
```

### Missing Featured Image

Every post MUST have a featured image. Always call `mediaSearch` first.

### No Media Search

```
# WRONG:
Using Unsplash URLs or random images

# RIGHT:
1. Call mediaSearch({ query: "...", count: 3 })
2. Pick best Getty Images URL
3. Use in featuredImage field
```

### Poor Title/Excerpt

```
# WRONG:
title: "Blog Post"
excerpt: "This is a blog post"

# RIGHT:
title: "7 Proven Strategies to Boost Your Morning Productivity"
excerpt: "Discover science-backed techniques to transform your mornings and accomplish more by noon than most people do all day."
```

---

## Multiple Posts

When user asks for multiple posts:

1. **Call mediaSearch for EACH post** (different query per topic)
2. **Create separate .md files** with unique slugs
3. **Vary the structure** (don't make them all identical)
4. **Use different categories/tags** appropriately

### Scheduling Multiple Posts

When creating multiple posts for a content calendar:

```
User: "Create 3 blog posts for the next 3 weeks"

1. Post 1: publishedAt: '2024-12-15T10:00:00Z' (this week - immediate)
2. Post 2: publishedAt: '2024-12-22T10:00:00Z' (next week - scheduled)
3. Post 3: publishedAt: '2024-12-29T10:00:00Z' (2 weeks - scheduled)
```

**Spacing recommendations:**

- Daily posts: Space 1 day apart
- Weekly posts: Space 7 days apart (same day each week)
- Bi-weekly: Space 14 days apart
- Monthly: Space 30 days apart (same day each month)

---

## Example: Creating a Fitness Blog Post

```
User: "Write a blog post about morning workouts"

1. mediaSearch({ query: "woman morning workout sunrise fitness", count: 3 })
   → Returns Getty URLs, pick best one

2. Create /src/content/blog/morning-workout-benefits.md:

---
title: "Why Morning Workouts Are a Game-Changer for Your Fitness Journey"
excerpt: "Discover the science-backed benefits of early morning exercise and how it can transform your day, boost your metabolism, and help you achieve your fitness goals faster."
author: "FitFlow Studio Team"
publishedAt: '2024-12-08T10:00:00Z'
category: "Fitness Tips"
tags: ["morning routine", "workout motivation", "fitness tips", "health"]
featuredImage: "https://media.gettyimages.com/id/1234567/photo/woman-morning-workout.jpg"
seoTitle: "Morning Workout Benefits: Transform Your Fitness | FitFlow"
seoDescription: "Discover why morning workouts boost metabolism, improve focus, and help you stay consistent. Science-backed tips from fitness experts."
published: true
---

# Why Morning Workouts Are a Game-Changer for Your Fitness Journey

[Write compelling, valuable content following structure guidelines above]
```

---

## Summary Checklist

Before creating each blog post, verify:

- [ ] Checked system prompt for today's actual date
- [ ] Checked system prompt for user's timezone (if user specified a time)
- [ ] Called `mediaSearch` and got Getty Images URL
- [ ] Using `publishedAt` (NOT `date`)
- [ ] Date is ISO 8601 format with time: `'2024-12-08T10:00:00Z'`
- [ ] Set appropriate publish date (current for immediate, future for scheduled)
- [ ] Converted time to UTC using detected timezone or asked user for timezone
- [ ] Using `featuredImage` (NOT `coverImage`)
- [ ] Featured image is full Getty URL
- [ ] Title is under 60 characters
- [ ] Excerpt is under 160 characters
- [ ] Content is 800+ words
- [ ] Includes clear section headings (H2, H3)
- [ ] Has valuable, actionable content
- [ ] Ends with clear call-to-action
- [ ] Published field is set to `true`

**Scheduling reminder:** To schedule a post, set `publishedAt` to a future date with `published: true`. The post will automatically appear on that date.

**Get these field names right and your blog posts will work perfectly!**

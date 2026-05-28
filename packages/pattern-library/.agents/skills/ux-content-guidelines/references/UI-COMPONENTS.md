# UI Component Writing Patterns

> How to write content for every GoDaddy UI component — formatting, casing, and length rules.

## Headlines

- A full sentence, in sentence case, no period.
- If a headline has multiple sentences, punctuate each sentence.
- Recommendation cards follow the same format.

> **Correct:** Get more followers with social ads
>
> **Incorrect:** Get More Followers with Social Ads.

> **Multi-sentence correct:** You've got email! We'll help you move it.

**Exception:** Headers on loading states can be incomplete sentences with ellipses.

## Eyebrows vs Subheads

Both should be full sentences with closing punctuation. Follow the reader's logic:

- **Eyebrow:** Connects where the user came from to where they're going next. Can acknowledge the previous step, introduce a new concept, provide the "why," or encourage the user.
- **Subhead:** Gives practical instructions, adds an FYI, clears up uncertainty, or explains the user's benefit.

Eyebrows don't give instructions on how to answer the headline's question and don't function the same as subheads.

## Section Titles

- Use title case, no closing punctuation.
- Describe what's in the section — avoid action-focused phrases.

> **Correct:** More Ways to Sell
>
> **Incorrect:** Get More Sales

## Buttons and CTAs

### Standard Buttons

- Title case. Don't capitalize prepositions like "an," "in," or "for."
- Keep to 3 short words or less.

> **Correct:** Start for Free
>
> **Incorrect:** Start For Free / Start My Trial for Free

### Longer Buttons

Sentence case when users need more context than fits a standard button.

### Tertiary CTAs

Sentence case, no closing punctuation.

### Writing Button Copy

- Button text should help users complete an action — concise, simple, with context for what comes next.
- Leave pronouns out of CTAs. Exception: use "my" when you want the customer to feel ownership. Never use "you/your" in CTAs.
- CTAs should match headlines when it makes sense.
- In multi-screen flows, "Continue" or "Next" may suffice.

## Alerts

- Message in sentence case, punctuated normally.
- Title and CTA in sentence case, no period.
- Keep alert messages to 1-2 sentences max, ideally just one.

## Bottom Sheet

Mobile-specific component that interrupts the user for input or additional info.

- **Title:** Full sentence, sentence case, no period. Should highlight the main action.
- **Body:** Short, direct, clear, and human. Provide details to help the user decide.
- **CTA:** Title case. No more than 2 short words.

> **Correct title:** Get more followers with social ads
>
> **Incorrect:** Get More Followers with Social Ads. / More Followers

## Modals

Contextual dialog boxes that appear after explicit action.

- **Title:** Full sentence, sentence case, no period. Highlight the main action.
- **Body:** Enough info for users to decide or move forward. Short, direct, clear, human.
- **CTA:** Title case. No more than 3 short words.

## Checkboxes

- Labels and group titles in sentence case, no closing punctuation.
- Use positive and active wording so it's clear what checking the box does.
- Group titles help simplify options and reduce repetition.

## Radio Buttons

- Labels in sentence case. Keep short and simple — no longer than one line.
- Group titles in sentence case.

## Toggle

- Labels in sentence case, no punctuation. Keep short and simple.
- Use positive and active wording so it's clear what toggling does.

## Dropdowns and Menus

- **Labels:** Sentence case (only capitalize the first word).
- **Menu items:** Title case (capitalize first letter of each word except minor words like "a," "the," "of").

## Input Fields

### Labels
- Every text input must have a label.
- Sentence case, 2-3 words, in noun form (not questions).

### Helper Text
- Sentence case. Optional — only use when the label can't clearly explain the purpose, you need more context, or you need to show character limits.
- Complete sentences get a period; fragments don't need one.

### Placeholder Text
- Use sparingly — never for critical info (it's not accessible).
- Use labels or helper text instead.
- Consider for search fields or to show short examples where there might be ambiguity.
- Sentence case; period only if it's a complete sentence.

### Input Field Errors
- Command-oriented language — tell users what they need to do.
- Full sentences, sentence case, with a period.
- Avoid "please" and "hmm." Choose functionality over tone in limited space.

## Error Messages

Always include a headline and body copy, regardless of pattern size. CTA is optional but recommended when there's a relevant next step.

### Headline
- A straightforward statement about the problem. Keep simple, relevant, no technical language.
- 1 sentence max. Sentence case.

### Body
- Use clear, plain language. Avoid technical jargon.
- Explain the issue briefly and non-technically (but only when it matters to the user).
- Offer a resolution. Don't omit it if there is one.
- Avoid blame and negativity. Don't use "don't worry," "oops," or "yikes."
- Provide a contact option if applicable.
- 1-2 sentences max.

### CTA Button
- Direct, relevant next step that mirrors the body copy.
- 3 words max. Title case.
- Common options: "Return to ___," "Refresh Page," "Check Status," "Learn More," "Contact Support"

### Tone Guidance for Errors
- **Our fault?** Take responsibility: "We're sorry, we can't find that image. Let's try again."
- **Minor fix?** More casual: "Uh oh. Something went wrong. Let's try that again!"
- **Solution available?** Always include it. If not, use "try again" or let them know you're working on it.
- **Technical?** Don't confuse users with overly complex language.

## Empty States

Prompt an action or provide a teaching moment where content will be added.

- **Headline:** 1 sentence explaining there's no content. Use neutral tone.
- **Body:** 1-2 sentences on how to add content. Not always needed if headline does the job.
- **CTA:** Match the step in the body copy. 3 words max. Don't use if no action needed.
- Avoid "Don't worry" — this isn't an error, so there's no need to comfort.

## Loading States

Let users know there's a brief delay while something happens behind the scenes.

- **Headline:** A few words to 1-2 sentences, sentence case, ending with ellipsis. Examples: "Publishing your domain..." / "Gathering templates..." / "Please wait..."
- **Body:** Optional. For waits longer than a few seconds, include wait time to reduce drop-off. 1-2 sentences, sentence case, with closing punctuation. No ellipses.

## Links

- Sentence case, no punctuation unless it's a complete sentence.
- Period at end of sentence should NOT be part of the link.
- Never use "click here." Link the destination or action.
- Links to defined product areas follow that area's capitalization (likely title case).
- Links of 3+ words use sentence case.

> **Correct:** Learn more in our Get Started Guide.
>
> **Incorrect:** Click here to learn more.

## Lists

Write a full sentence introducing the list. Only use colons in body copy, not to introduce lists. Punctuate list items consistently — all full sentences with periods, or all fragments without periods.

## Tooltips

- Used to explain concepts, add context, or help complete tasks.
- 1 sentence preferred, never more than 2.
- Complete sentences in sentence case with closing punctuation.
- Don't bury pertinent info in tooltips (users may not click them).

## Popovers

- **Title:** Incomplete sentences, title case, no closing punctuation. Highlight the main idea.
- **Body:** Short, direct, clear. 1-2 key points.
- **CTA:** Title case, 1-2 short words.

> **Correct title:** Profile Tab
>
> **Incorrect:** Welcome to your profile tab!

## Growls

- **Title:** Title case, 1-3 words summarizing the growl's purpose. Not a complete sentence, no period.
- **Message:** Full sentence, sentence case, with closing punctuation.

## Tables

- Column headers in title case. Keep brief and direct to avoid text wrapping.

## Tags

- Written in ALL CAPS, no more than 2 words.
- Use only when important for the user journey — as labels and organizers.
- Don't overuse (they lose meaning). Avoid advertising language that belongs in headers or body copy.

## Collapsible

- Titles: concise (few words or short sentence), sentence case, no closing punctuation.
- Exception: FAQ collapsible questions should include question marks.

## Product Tour

Combines modal and popover components:
- **Modal intro:** Follow modal rules (full sentence headline, sentence case, no period).
- **Popover steps:** Follow popover rules (incomplete sentence title, title case, no punctuation).
- **Navigation CTAs:** Use "Next," "Back," and "Done" for first, intermediate, and final steps.

## Wizards

Multi-step flows for onboarding or creating new things.

- **Cards-as-buttons:** Complete sentence, sentence case, no period.
- **Selection cards header:** Full sentence, title case, no period.
- **Selection cards body:** Full sentence with closing punctuation. Share helpful details and set expectations.

## Navigation + Page Titles

- Page titles should match nav labels for wayfinding.
- If a page is dedicated to a specific action, use a subtitle for the explanation.

## File Upload

Add a short, descriptive label inside the drop zone. Sentence case, no closing punctuation.

## FAQ

Always abbreviate "Frequently Asked Questions" to FAQ. No "s" — never "FAQs."

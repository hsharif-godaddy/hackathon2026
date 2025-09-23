# GoDaddy Design System Documentation

## Component Guidance

## Accordion

**Description**

* An accordion is a container for multiple collapsible components. Unlike simply grouping these components, accordions ensure that only one item can be open at any given time.

**Best Practices**

* See Collapsible best practices.

---

## Alert

**Description**

* An alert is used to highlight important, typically contextual and timely, information.

**Best Practices**

* Use alerts sparingly and only when necessary to minimize distractions.
* Avoid displaying multiple alerts simultaneously to prevent alert fatigue.
* Ensure alerts appear on load or as a result of a user action; unexpected alerts can be interruptive, especially for assistive technology users.
* Use one call‑to‑action per alert to guide the user toward the most appropriate action.
* For dismissible alerts, use the built‑in dismissible property that adds a close button—don’t duplicate close functionality.
* Hide alerts once they are no longer relevant.

**Content Guidance**

* Keep messages brief but informative.
* Avoid using line breaks.
* Add a title if necessary.
* Ensure the call‑to‑action label is actionable and concise.

---

## Bottom sheet

**Description**

* Analogous to a modal but for small screens, a bottom sheet provides a contextual drawer that appears after explicit action and temporarily interrupts the user to demand input or present additional information. Designed explicitly for mobile/touch interfaces.

**Best Practices**

* Don’t use bottom sheets on desktop or non‑touch devices—use a modal or takeover instead.
* Don’t add spacing around a bottom sheet; sheets extend the full width.
* Use bottom sheets for inline menus where appropriate.
* Don’t nest sheets (never open a bottom sheet inside another sheet).

**Content Guidance**

* Make titles purposeful.
* Provide helpful information in the sheet body.
* CTAs should have explicit, clear labels.

---

## Box

**Description**

* A simple layout utility mirroring Figma auto‑layout frames in code. Provides direction, padding, and gap. Used to build other components. In design, use Figma auto‑layout directly rather than a component instance.

**Best Practices**

* Apply standardized spacing using four main layout variables (XL, Lg, Md, Sm) to maintain consistency.
* **XL – Page level space:** Use around canvas edges, between content columns, and to pad heroes/modals.
* **Lg – Containers and cards:** Pad cards and create equal gaps within them.
* **Md – Default:** General‑purpose gaps; spacing between paragraphs and buttons; padding around dense elements.
* **Sm – Content:** For closely related items (e.g., grouped buttons, text lockups).
* Use Box to create consistent spacing between elements.
* **Padding for containers:** Apply when bordered or adjacent to differing backgrounds; typically equal on all sides.
* **Gap for containers:** Create space between elements within a frame; group with smaller gaps for stronger association.
* Zero padding/gap is acceptable when it improves layout.
* Use auto layout frames to change flow direction (rows/columns), align content, or create responsive wraps (with care).
* Keep padding symmetrical; group similar items with consistent small gaps; use spacing to reinforce relationships.
* Apply Gestalt proximity: similar items closer together; different groups farther apart.

---

## Button

**Description**

* A clickable element that triggers actions such as creating information, completing a purchase, or removing an item.

**When to Use**

* To initiate an action (e.g., submit a form).
* To confirm an action (e.g., confirm deletion in a modal).

**When Not to Use**

* Don’t use for navigation; use links for page changes.

**Best Practices**

* **Shape:** Use rounded corners (6px standard).
* **Size:** Default size suits most cases; adjust via size property when needed.
* **Groups:** Prefer tertiary buttons in groups instead of inline links; weight signals interactivity.
* **Alignment:** Use left‑aligned F‑pattern in most cases; right‑aligned Z‑pattern in modals/wizards for forward progress.
* **Width:** Avoid full‑width stretch; size proportionally to label.
* Buttons may be text‑only, text + icon, or icon‑only across variants.

**Content Guidance**

* Keep labels concise and action‑oriented; avoid “you/your.”
* **Title case** for labels; don’t capitalize short prepositions.
* Prefer ≤3 short words; use verb–noun; avoid articles.
* Tertiary CTAs (longer text) use sentence case without punctuation.

**Variants**

* **Primary:** High emphasis for the most important action. *Best practice:* Use one primary action per screen/container; multiple only in rare, clearly separated contexts.
* **Secondary:** Medium emphasis; most commonly used.
* **Tertiary:** Lower‑emphasis text‑style action; often adjacent to primary/secondary; ensure consistent padding/affordance.
* **Inline:** Underlined, heavier weight text placed within body copy; ensure separation from surrounding text.
* **Control:** For nested controls within components (e.g., inputs/cards); usually consumed via component APIs.

**States**

* Default, Hover, Active (pressed), Focus (keyboard‑visible), Disabled, Critical (for destructive confirmation).

---

## Card

**Description**

* Versatile container encapsulating content and actions for a single subject; supports text, media, and actions.

**Best Practices**

* Use consistently to maintain structure.
* Keep content concise; avoid overcrowding.

**Variants**

* **Button:** Acts like a button to trigger navigation or actions.
* **Checkbox:** Enables multi‑select across a set.
* **Link:** Navigational card to detailed views or related info.
* **Radio:** Single exclusive selection from a set.

**States**

* Default, Hover, Checked/Selected (for selectable cards).

---

## Charts

**Description**

* Visual aids to help users understand and compare data.

**Best Practices**

* Don’t use sample data unless clearly marked.
* Avoid cognitive overload; limit data quantity.
* Add a legend when needed for clarity (legend is a separate construct).

**Variants**

### Line

**Description**

* Ideal for trends over time or continuous data; supports multiple datasets.

**When to Use**

* Understanding trends; time series; relationships between X/Y.
* Consider sparklines in table cells (remove labels, no fill; semantic color as needed).

**Best Practices**

* X‑axis: time (days/weeks/months/quarters).
* Y‑axis: metrics; limit to ≤3.
* Set sensible min/max (e.g., 0–100% for percentages).

**Options**

* Smooth line, Multiple lines, Discontinuous lines, Shaded area, Grid lines, Axis (as separate component), Axis labels.

### Donut

**Description**

* Circular chart showing proportions; segments total 100%.

**When to Use**

* Illustrate parts of a whole (e.g., domain type distribution).

**Best Practices**

* Use system palette; default \~400×400 is typical; avoid full‑page scaling.

**Options**

* Colors (theme or custom set), Label formats (custom center value formatting).

### Bar

**Description**

* Compare discrete categories.

**When to Use**

* Category/group comparisons.

**Best Practices**

* Use color coding consistently; align labels clearly; provide legends.

**Options**

* Colors (theme or custom set).

### Stacked Percentage

**Description**

* Shows percentage contributions of series stacked to 100%.

**When to Use**

* Compare parts of a whole across categories (e.g., resource usage, survey responses).

**Best Practices**

* Include size labels where relevant, centered within segments.
* Use patterns/textures with color for color‑blind accessibility; ensure high contrast labels.

**Options**

* Percentage display (stack to 100%), Category labels (with optional sizes), Legend below chart.

---

## Checkbox

**Description**

* Enables selecting one or more options from a set; can be standalone or grouped (use Sibling Set for group layout and error handling).

**When to Use**

* Present multiple independently selectable options.
* Lists with sub‑selections.
* Opt‑in/consent (e.g., “I accept the terms and conditions.”).

**When Not to Use**

* To start a workflow/process.
* To indicate static lists or progress (use bullet lists or icons instead).
* For binary settings (use Toggle).

**Best Practices**

* Use Sibling Set to space vertical groups.
* Provide a group title for context and screen reader summaries.
* Simplify titles/labels to reduce repetition; aid scanability.
* Use **indeterminate** when a group has mixed selections; clicking cycles to all‑selected, then unselected.

**Content Guidance**

* Use positive, active wording.
* Group titles and labels in sentence case without punctuation.

**States**

* Unselected, Hover, Checked/Selected, Indeterminate.

---

## Chips

**Description**

* Compact pills for selections and filtering; can toggle, open menus, or represent user‑added tokens; may include icons and dismiss/dropdown indicators.

**When to Use**

* Filter interactions, multi‑select lists, input tokens, multi‑select in onboarding.

**When Not to Use**

* Don’t use alone; don’t replace buttons or tabs; avoid for multi‑select in forms; don’t replace toggles.

**Best Practices**

* Keep labels brief—chips truncate and shouldn’t wrap.
* Prefer groups (ideally ≥3); if not, consider menu/checkbox/toggle.
* Chips are inline; flow horizontally and wrap like text; avoid vertical stacks.
* Avoid mixing chip types or sizes within a group; separate types with spacing/dividers if necessary.
* Removable chips represent user input; use inside inputs or near filters; must be keyboard removable.

**Variants**

* **Toggle Chip:** On/off filter or multi‑select toggles; never a group of one.
* **Menu Chip:** Configures a filter via a flyout; label reflects selection when active.
* **Removable Chip:** Represents specific selections or filters; removable via “X” or keyboard.

---

## Circular Progress

**Description**

* Circular indicator showing progress toward completion of a task/process.

**When to Use**

* Expressive progress moments (e.g., gauges, setup widgets).

**When Not to Use**

* Indeterminate processes (consider Spinner) or when a linear bar is more effective.

**Best Practices**

* Avoid for indeterminate processes.
* Multiple progress indicators on one page are acceptable.
* Choose size mindful of space; default recommended; small/XS for tight contexts (e.g., tables).

**Content Guidance**

* Use to communicate task/process progress clearly.

**Variants**

* **Size:** small, default, extra small.
* **Color:** default, critical, success, warning.

---

## Collapsible

**Description**

* Hides content behind a summary; clicking title/chevron reveals details; chevron rotates to indicate state. Core building block of accordions.

**When to Use**

* Progressive disclosure of details.
* FAQ lists with brief answers.
* Multi‑step forms within a single page to focus the user.

**When Not to Use**

* Don’t use as a menu (the summary itself isn’t a selectable item).

**Best Practices**

* Keep styling consistent with theme; don’t override to draw attention or compress beyond intent.
* Icons should indicate status, not category/emphasis.
* Don’t nest collapsibles for multi‑level drill‑down; consider navigation, tabs, or modals instead.
* Avoid wrapping titles; keep them brief.

**Content Guidance**

* Titles concise; sentence case without punctuation (except question marks in FAQs).

---

## Criteria

**Description**

* Displays a single input validation rule with visual feedback; used in a list of rules that must be met before acceptance.

**When to Use**

* When user input must meet specific requirements (e.g., password rules).

**When Not to Use**

* To indicate “required” fields.
* To enforce strict formatting where flexible parsing is possible; use specific inputs (e.g., Date) and show errors on failure.
* To display running character counts (use helper text instead).

**Best Practices**

* Show Criteria in a menu context (paired with Menu); avoid placing in‑page independently.

**States**

* **Invalid / Default:** Shows invalid until requirement is met.
* **Valid:** Shown once requirement is met.
* **Processing:** While server evaluates the rule.

---

## Date Input

**Description**

* Allows selecting a specific date or a range; opens a calendar on interaction.

**When to Use**

* To capture a full date.
* To modify an existing date.

**When Not to Use**

* To capture partial dates (use Text Input with helper text or Select for months; avoid year selects when long).
* When selecting dates far from today if calendar navigation is cumbersome; consider direct input.

**Best Practices**

* Ensure component receives the user’s locale (handles dd/mm/yyyy vs. mm/dd/yyyy).
* Default selector to current month/year.
* Disable unavailable dates (e.g., past/future days, weekends) as needed.

**Content Guidance**

* Prefer spelled‑out month/day when space allows (e.g., “Thursday, October 11, 2016”).
* Avoid digit‑only formats to prevent ambiguity; follow international date conventions when relevant.
* Correct examples: “October 11, 2016”, “Oct 11, 2016”.

**States**

* Default, Disabled, Focused, Invalid.

**Variants**

* **Float label:** Label inside the input.
* **Date range:** Em‑dash between start/end.
* **Size small:** Smaller input; no float label.

---

## Empty States

**Description**

* Appears when no data is displayed; describes what the user can do next; typically includes an illustration and a tagline.

**When to Use**

* No data to display.
* Search returns no results.

**Best Practices**

* Use pictograms for small/medium and utilitarian illustrations for large, expressive contexts.
* Prioritize a concise headline over body copy.
* Body copy should explain what to do, why it’s empty, and why to act (1–2 sentences).
* Use a secondary CTA in most cases; reserve a primary CTA only when it’s the only on‑screen action.
* Keep illustrations neutral and on‑brand.
* Prefer secondary CTAs when a primary is already present on the screen.

**Content Guidance**

* **Headline:** 1 sentence max; straightforward (e.g., “You don’t have any connections yet.”).
* **Body copy:** 1–2 sentences adding context (e.g., “Connections can be imported or entered manually.”). Omit if headline suffices.
* **CTA:** 2–3 words reflecting the prompt (e.g., “Add contacts”). Include only when action is needed.
* Use a neutral, constructive tone; avoid negative filler (e.g., “Don’t worry”).

**States (Compositions)**

* Illustration + Headline + Body + CTA
* Headline + Body + two CTAs
* Headline + Body + CTA
* Headline + Body

---

## File Upload

**Description**

* Control for uploading one or more files; supports multiple MIME types and max file size; drag‑drop or browse behaviors.

**When to Use**

* When users must upload files (e.g., gallery images), with drag‑drop or browse options.

**When Not to Use**

* For non‑file inputs (text, dates, time, etc.).

**Best Practices**

* Consider placing in a modal for long forms or many files; left‑align when not full‑width.
* Provide a separate submit/complete action when required (the component doesn’t include submit by default).
* Avoid adding file upload to long forms; prefer isolating as a step (e.g., in a dialog) with a heading.
* Avoid multiple file upload controls on one page.
* Avoid overly tall/narrow drop zones; default to full content width; ensure comfortable drop target.

**Content Guidance**

* Be concise; include a short label inside the drop zone describing what to upload.

**States**

* **Enabled:** Interactive.
* **DragOver:** Drop zone lightens on hover.
* **Disabled:** Not recommended; prefer hiding the control when unavailable.

---

## Filter

**Description**

* A pattern for narrowing datasets.

**Best Practices**

* Provide clear, relevant filter controls.
* Avoid overwhelming users with too many filters.
* Make applied filters visible and easy to remove.

**Content Guidance**

* Use concise labels.
* Provide contextual helper text where needed.
* Group related filters logically.

---

## Growl

**Description**

* Non‑modal notification in the top‑right informing users of system events; auto‑dismisses after a timeout or can be persistent until dismissed.

**When to Use**

* Notify about in‑process or completed operations without blocking work.
* Show messages that allow continued interaction.
* Surface out‑of‑context notifications (e.g., background publish completes after navigation).

**Best Practices**

* Choose timeout vs. persistent based on importance; persistent for critical, actionable issues.
* Avoid interactive form controls inside a growl; use modals or inline UI for interaction.

**Content Guidance**

* **Title:** Title case, 1–3 words, no period.
* **Message:** Full sentence, sentence case, with punctuation.

**Variants**

* Success icon, Warning icon, Error icon, Dismissible (recommended), No title.

---

## Icons

**Description**

* Minimal graphics representing actions, concepts, or brands.

**When to Use**

* Compact action lists (toolbars).
* Supplement labels for clarity (e.g., plus icon with “Add”).
* Represent UI actions (open menu, collapse, external link).
* Add hierarchy in link lists (e.g., cart in header).

**When Not to Use**

* In place of text for complex concepts.
* In place of text when space is available.

**Best Practices**

* Use Icon Button for actions to meet target sizes.
* Pair with tooltips to clarify intent.
* Include labels for less experienced users.
* Size icons \~150% of adjacent text height (e.g., 24px next to 16px text).
* Don’t distort; maintain aspect ratio.
* Maintain consistent stroke weight.
* Avoid custom colors; prefer black/high contrast per brand guidance.

---

## Menu

**Description**

* Collection of items/actions revealed on interaction; used with Select Input, Search Input, or Button for dropdowns, search previews, and action menus.

**When to Use**

* Display multiple related actions in limited space.
* Require a single selection from many options.
* Preview search results inline.

**Best Practices**

* Don’t use for date picking (use Date Input/Calendar).
* Appropriate for telephone inputs.
* Note: native select rendering may differ from proprietary styles; align expectations with engineering.

**Content Guidance**

* Labels: sentence case.
* Menu items: title case (except small words like “a,” “the,” “of”).

---

## Message Overlay

**Description**

* A non‑interactive overlay message that prevents interaction with covered content until dismissal by system or prerequisite completion.

**When to Use**

* Prevent duplicate actions during processing (e.g., payment submission processing).
* Obscure part of a UI until prerequisite data is entered (disappears on completion; don’t add spinner here).
* Focus attention on an error message.

**When Not to Use**

* Initial page load (use Spinner for small areas or skeletons where appropriate).
* Don’t add a spinner when dismissal depends on user action.

**Best Practices**

* Place to obscure only associated content, not entire page (unless appropriate).
* Trigger on user interaction, not initial load.
* Use Spinner vs. Overlay appropriately for small content loads.

---

## Modal

**Description**

* Contextual dialog appearing after explicit user action; blocks background interaction via backdrop. Must have a clear purpose, be user‑initiated, and be dismissible.

**When to Use**

* Confirm destructive/irreversible actions.
* Request focused input (from simple choices to uploads).
* Select/edit media or assets within complex flows.
* Celebrate/confirm high‑impact changes.
* Present additional information (e.g., legal, plan details).

**When Not to Use**

* Overly complex tasks (prefer full‑screen takeovers/pages).
* Onboarding flows (prefer full‑screen wizards).
* Background state changes (prefer Alert or Growl).
* Promotional popups on load (avoid auto‑appearing modals).
* Frequently accessed actions (prefer inline page UI).

**Best Practices**

* Never surprise users; must follow explicit input.
* Keep tasks simple; use takeovers for complex flows.
* Don’t nest modals; update content within the same modal if needed.
* Limit to one primary and one secondary/tertiary action.
* Use for confirming destructive actions.
* Use sparingly; avoid forcing flows into modals.
* **Mobile patterns:**

  * Bottom sheets for most scenarios; anchored, swipeable with detents.
  * Full takeover for flows needing full space.
  * Simple dialog for brief confirmations/celebrations.

**Content Guidance**

* **Title:** Full sentence, sentence case, no period; highlights main action.
* **Body copy:** Short, direct, clear, human.
* **CTA:** Title case; ≤3 short words.

**Variants**

* **2400:** Updated radii/padding.
* **Beta:** Adds high‑contrast overlay.
* **Pre‑2400:** Prior overlay/radii.

**Options**

* **Size:** Default (\~788px), Large (\~1064px), Full (100%).
* **Breakpoint:** Desktop/Mobile responsive ranges.
* **Buttons:** Default ordering; optional stacked buttons for mobile.

---

## Pagination

**Description**

* Navigates large datasets by segmenting content into pages; common for listings/search results.

**When to Use**

* Large datasets, content discovery, sequential navigation.

**When Not to Use**

* Small datasets (single page), real‑time data, complex navigation paths.

**Best Practices**

* Place at the bottom of associated content for easy navigation after reading.

---

## Password

**Description**

* Input for capturing user passwords; part of the Input Field Subsystem.

**When to Use**

* Log in, create/reset password (with Criteria), gating access to sensitive info.

**When Not to Use**

* For non‑password inputs (use appropriate input type).

**Best Practices**

* Include visibility toggle.
* Prefer text labels (“Show/Hide”) over icons for visibility.

**Content Guidance**

* Concise, clear label.

**States**

* Default, Focused, Error, Disabled.

---

## Popover

**Description**

* Contextual guidance for new/complex features; opens on click/tap, remains until dismissed; can include richer content and a close control.

**When to Use**

* Introducing new features.
* Onboarding basics (vs. full tour).
* Highlighting UI elements.
* **Tooltip vs. Popover:** Tooltip is brief on hover/focus; Popover opens on click/tap and persists with richer content.
* **Full tour vs. Individual popovers:** Full tour for broader introductions with step/time expectations; individual popovers to spotlight a single feature.

**When Not to Use**

* Avoid multiple simultaneous popovers; don’t use for simple, self‑explanatory tasks.

**Best Practices**

* Don’t overload with information.
* Ensure user control to dismiss/skip.
* Limit to one visible at a time to avoid overload.

**Content Guidance**

* **Title:** Optional; title case fragment, no punctuation.
* **Body:** Short, direct, clear, human; 1–2 key points.
* **CTA:** Title case; concise (1–2 words).

---

## Pivot

**Description**

* Selectable list item (“slat” for single selection, “tile” for multi‑selection); suitable in constrained spaces.

**When to Use**

* Top‑level settings lists.
* Mobile alternative to wide tables with many columns.
* Interactive lists in limited space (mobile/sidebars).

**When Not to Use**

* Navigating top‑level pages (use Tabs / in‑page nav).
* Simple booleans (use toggles/checkboxes).

**Best Practices**

* Provide a back link when opening a new view from a pivot.

**Content Guidance**

* Concise, clear titles for scanability.

**States**

* Default, Selected (tile design only).

---

## Product Tour

**Description**

* Guides users through steps/features for interactive learning; highlights new features, offers tutorials, or assists in complex tasks.

**When to Use**

* First‑time onboarding.
* Complex task navigation.

**When Not to Use**

* For single new features (prefer simple Popover).
* Straightforward tasks.
* Excessive interruptions.
* As a patch for poor UI; improve design instead.

**Best Practices**

* Keep it short (ideally ≤3 steps).
* Goal‑oriented: measurable reduction in friction and improved task success.

**Content Guidance**

* **Modal Title:** Full sentence, sentence case, no period.
* **Modal Body:** Short, direct, clear; set expectations/time.
* **Modal CTA:** Title case; ≤3 short words.
* **Popover Title:** Title case fragment, no punctuation.
* **Popover Body:** Short, clear, human.
* **Popover CTA:** Title case; use Next/Back/Done appropriately.

**Variants**

* Starter Modal, First Step Popover (no back), Intermediate Popover (Back/Next), Final Popover (Exit/End Tour).

---

## Progress Bar

**Description**

* Rectangular container that fills to indicate progression toward completion.

**When to Use**

* Deterministic processes (e.g., uploads) or percentage values over time (e.g., profile completion).

**When Not to Use**

* Indeterminate processes (prefer Spinner).

**Best Practices**

* Avoid placing within body text.
* Use labels/percentage/helper text as needed for clarity.

**Options**

* **Size:** default, small, extra small (height).
* **Status:** default, success, warning, critical (semantic color).

---

## Progress Steps

**Description**

* Guides users through multi‑step tasks; shows current step and allows navigation between steps.

**When to Use**

* 3 or more steps; each step can be titled; non‑linear navigation; low‑expressiveness surfaces.

**When Not to Use**

* Outside wizard flows; high‑expressiveness UIs; few steps; when a simple progress bar or step‑indicator suffices.

**Best Practices**

* Keep step count within available width (consider mobile constraints).
* Labels of 2–3 words.
* Use theme‑provided colors/icons.

---

## Quantity Selector

**Description**

* Lets users increment/decrement or type small whole numbers; part of the Input Field Subsystem.

**When to Use**

* Small quantities (1–2 digits), e.g., item counts.

**When Not to Use**

* 3+ digit numbers; when increment/decrement is not useful; formatted numbers (e.g., prices); decimals/fractions.

**Best Practices**

* Limit to small, whole numbers.
* Prefer non‑floating labels around adjacent buttons for clarity.
* Set sensible defaults (e.g., 1 for cart quantities).
* Set min/max limits; disable controls at bounds; provide helper text if needed.

**Content Guidance**

* Concise label.

**States**

* Default, Focused, Invalid, Disabled.

**Options**

* **Size:** Medium (default), Small.
* **Label:** Regular (above) or Floating (medium only).

---

## Radio

**Description**

* Form element for selecting one option from a set; group via Sibling Set for spacing and errors.

**When to Use**

* Two or more options where only one can be selected.
* Options requiring comparison/context (otherwise consider Menu).

**When Not to Use**

* Binary toggles.
* Multiple selection (use Checkbox).

**Best Practices**

* Use Sibling Set for spacing.
* Limit options to \~7; use Menu for long lists.
* Defaults: choose safest/most secure or most likely option.
* Order logically (likelihood, complexity, risk).
* Include “Other/None” when appropriate.

**Content Guidance**

* Sentence‑case labels and group titles; keep labels short (≤1 line).

**States**

* Unselected (default), Selected (one per set), Invalid, Disabled.

---

## Search

**Description**

* Text input + button allowing users to find information without navigation; part of the Input Field Subsystem.

**When to Use**

* Search within an account/venture/page datasets (e.g., domains, orders).
* Filter a set of items (orders, tasks, products).
* Domain search within product experiences.

**Best Practices**

* Only one search per page/scope to avoid ambiguity.
* Use Menu to display search results as user types.
* Place at the top of its search context.

**Content Guidance**

* Direct, concise input text and placeholders suited to context (e.g., “Search by business name”).

**States**

* Default, Focused, Filled (with clear X), Disabled.

**Options**

* Button styles: Icon‑only, Dropdown, Icon + text, Text‑only.

---

## Select Input

**Description**

* Single‑select dropdown of predefined options; part of the Input Field Subsystem.

**When to Use**

* Lists of \~6+ items or when conserving vertical space.

**When Not to Use**

* ≤5 options and space allows (prefer Radio group).
* When a specialized input exists (Date, Quantity, Telephone, etc.).

**Best Practices**

* Provide a sensible default selection when appropriate.
* Order options logically (alphabetical is a good default).
* Size input to accommodate typical option length.

**Content Guidance**

* Concise label.

**States**

* Default, Focused, Invalid, Disabled.

**Options**

* **Size:** Medium (default), Small.
* **Label:** Regular (above) or Floating (medium only).

---

## Slider

**Description**

* Lets users select value(s) within a range. Types: single‑value (default) or range; continuous or discrete (snaps to ticks).

**When to Use**

* Values on a continuum with fixed bounds; overview of full range; whole numbers with low precision needs; equal segment ratings; visual manipulation with instant feedback (e.g., volume/brightness).

**When Not to Use**

* Category selections (use Radio/Checkbox).
* Binary settings (use Toggle).
* Fractions/decimals when precision is key.
* Custom arbitrary values requiring text input.

**Best Practices**

* Provide a short label describing the setting.
* Ensure comfortable target sizes, especially on touch.
* Don’t use sliders for non‑numeric values.

**Content Guidance**

* Short, noun‑form label; optional helper text to clarify use.

---

## Spinner

**Description**

* Looping animation indicating an ongoing process; appears immediately on action and disappears when content loads.

**When to Use**

* Ongoing processes (unknown duration) or >1s waits.
* Multiple asynchronous element loads (e.g., image gallery).

**When Not to Use**

* Determinable/long processes where a progress percentage is meaningful (use Progress Bar).
* When UI must be blocked (use Message Overlay).

**Best Practices**

* Place spinner in the area where content is loading; choose appropriate size.
* Provide a descriptive label for the running process.
* Don’t embed a spinner in the initiating button.
* Don’t disable the initiating button; use overlays to block if necessary.
* Don’t include text or other elements inside the spinner.

**Content Guidance**

* Concise, accurate labels; use ellipses for ongoing actions (“Loading…”). Avoid duplicating ellipses across multiple headings.

**Options**

* **Size:** small, medium, large.

---

## Table

**Description**

* Helps users understand, compare, and act on structured data.

**When to Use**

* Comparing multiple data subjects across the same attributes.

**When Not to Use**

* When data is simple enough for lists or cards.

**Best Practices**

* **Alignment:** Keep columns consistently aligned; numbers right‑aligned for comparison; other content left‑aligned. Rows align to top.
* **Consistency:** Don’t mix densities or cell types within a column.
* **Scrolling/Overflow/Responsive:** Tables may overflow; allow native vertical scrolling; horizontal scrollbar appears at viewport bottom when needed; large tables often overflow even on desktop—plan accordingly.
* **Pinned elements:** Pin headers (and left columns if needed) to maintain context; consider data table libraries for advanced pinning.
* **Modalities:** Treat tables as content—scroll with container; avoid long tables or horizontal scroll in small modalities (tooltip/popover/bottom sheet); prefer dedicated pages or full‑screen takeover for very large tables.
* **Popover:** Avoid long/interactive/sortable tables inside popovers; no sticky headers there.

**Content Guidance**

* Column headers in Title Case; keep labels brief to avoid wrapping.

**Options**

* **Density:** small, medium, large.
* **Cell Types:** Standard text (optionally with icon), Links, Text lockup (use sparingly), Checkboxes (row selection), Tags (status), Icon buttons (row actions; use overflow menu for extras), Buttons, Status icons (use semantic intents), Media (images, audio, video, files).

**States**

* Default, Focused, Invalid, Disabled.

---

## Tabs

**Description**

* Organizes and navigates closely related content within the same context via a horizontal list of buttons.

**When to Use**

* Organize related but distinct content.
* Conserve space by grouping content in one area.

**When Not to Use**

* Complex/global navigation (use nav bars/sidebars).
* Primary navigation; Tabs are best for in‑page/section navigation.

**Best Practices**

* Maintain consistent usage across contexts.
* Limit number of tabs for readability.
* Use concise, descriptive labels.

**Variants**

* **Underline:** Text‑only tabs with colored underline on active.
* **Manila:** File‑folder metaphor with surrounding border highlighting active.
* **Button:** Active tab styled like a subtle button.

**States**

* Default, Hover, Active/Selected.

---

## Tag

**Description**

* Communicates status or category at a glance.

**When to Use**

* Convey status or categorize items.

**When Not to Use**

* Not interactive; avoid for user‑applied indicators (that’s not the tag’s purpose).

**Best Practices**

* Avoid custom tag styles/colors; prefer available options.
* Match emphasis to severity/nature of message.
* Place tags next to the related entity.
* Optional icon should complement label.

**Content Guidance**

* All caps; ≤2 words; accurate status labels; avoid overuse (e.g., tagging every free experience).

**Variants**

* Filled, Inline, Indicator, Inline Indicator.

**Options**

* Icon (for non‑indicator tags), Size (small/default/large), Emphasis (critical, warning, success, info, highlight, neutral, passive, internal, default, premium), High‑contrast (all except default).

---

## Telephone Input

**Description**

* Captures phone numbers; part of the Input Field Subsystem.

**When to Use**

* Account creation/updates or other flows requiring a phone number.

**When Not to Use**

* For non‑phone inputs.

**Best Practices**

* Pre‑fill country code based on market.
* Ensure prominence when critical to task completion.

**Content Guidance**

* Concise label.

**Options**

* **Size:** Default (medium), Small.
* **Label:** Regular (above) or Floating (medium only).

**States**

* Default, Focused, Invalid, Disabled.

---

## Text

**Description**

* Base component for typography standardization; modified via `as`, `emphasis`, and `size` variants.

**When to Use**

* Any standalone text outside other components; ensures themeable typography across brands.
* Inside detachable placeholder areas (e.g., modal, wizard).

**When Not to Use**

* Some components constrain text styles; coordinate with engineering for special cases (e.g., inputs, menus, buttons).

**Best Practices**

* Prefer **Text Lockup** for hierarchy (eyebrow/title/paragraph), max line length, vertical spacing.
* Limit line width (50–75 characters ideal for body text); Text Lockup can enforce legibility.
* In Figma, apply **Global Intents** text styles for semantics; apply emphasis via library text colors.

**Options**

* **As:** heading, title, paragraph, action, caption, label, input (applies appropriate font family/weight/size/line height).
* **Emphasis:** critical, warning, success, information, highlight, neutral, passive, internal, default, premium.

---

## Text Input / Textarea

**Description**

* Single‑line vs. multi‑line free‑form text inputs; in UXCore they are variants of Text Input; part of the Input Field Subsystem.

**When to Use**

* Free‑form alphanumeric values; Text Input for short strings; Textarea for longer multi‑line text.

**When Not to Use**

* When specialized inputs exist (Date, Quantity, Select, Telephone, etc.).

**Best Practices**

* Form layout mirrors real‑world representation (e.g., vertical address).
* Size inputs to expected value length.
* Use Textarea for long content.
* Avoid mixing floating and non‑floating labels in the same form.
* Avoid critical info in placeholders; validate on blur/field completion; show contextual errors via built‑in messages.

**Content Guidance**

* Concise label.

**Options**

* **Size:** Medium (default), Small. Textarea height = lines.
* **Label:** Regular (above) or Floating (medium only).

**States**

* Default, Focused, Invalid, Disabled.

---

## Text Lockup

**Description**

* Consistent combination of text elements (eyebrow, title, supporting text) with built‑in spacing, hierarchy, and responsive behavior.

**When to Use**

* Any place requiring multiple related text elements (pages, cards, modals, etc.). Can also be used for a single piece of text while preserving semantics.

**Best Practices**

* Prefer using Text Lockup to maintain consistency; if diverging, build custom hierarchies using semantic intents so engineering can reproduce.

**Variants**

* **Page Headline (XXL):** For in‑product page titles (Eyebrow: Caption XXL; Title: Title XXL; Paragraph: Paragraph XXL).
* **Hero (XL):** For standout editorial content (Eyebrow: Caption XL; Title: Title XL; Paragraph: Paragraph XL).
* **Section Headline (L):** For section/feed titles (Eyebrow: Caption LG; Title: Title LG; Paragraph: Paragraph LG).
* **Default (M):** Typical content headlines (Eyebrow: Caption MD; Title: Title MD; Paragraph: Paragraph MD).
* **Small (S):** Smaller headlines (Eyebrow: Caption SM; Title: Title SM; Paragraph: Paragraph SM).
* **Extra Small (XS):** Rare, for disclaimers/compact help (Eyebrow: Caption XS; Title: Title XS; Paragraph: Paragraph XS).

---

## Time Picker

**Description**

* Lets users select a time from predefined options; implemented with Select Input patterns; part of the Input Field Subsystem.

**When to Use**

* Scheduling (tasks/appointments/reminders); often paired with Date Input.
* When selecting from a predefined list of times.
* When the value should be returned as a date object.

**When Not to Use**

* Free‑form time entry; when a date object return isn’t needed; for non‑time data.

**Best Practices**

* Provide a sensible default selection when appropriate.
* Size input to show typical option lengths.

**Content Guidance**

* Concise label.

**Options**

* **Size:** Medium (default), Small.
* **Label:** Regular (above) or Floating (medium only).

**States**

* Default, Focused, Invalid, Disabled.

---

## Toggle

**Description**

* Binary control that switches between on/off states.

**When to Use**

* Binary settings with immediate effects (e.g., dark mode).

**When Not to Use**

* More than two mutually exclusive visible options (use Radio).
* Single selection from a list (use Menu).
* Actions requiring confirmation (use Checkbox + Button).

**Best Practices**

* Default settings to off before user input.
* If the label names the setting, keep it constant across states; if labeling the current state, add a separate setting label.
* Don’t require confirmation for toggles.

**Content Guidance**

* Sentence case labels without punctuation; short and positive/active wording.

**Options**

* **Size:** Small, Default (medium).

**States**

* Default (Off), On, Disabled, Pressed, Keyboard Focused, Keyboard Focused + Pressed, Keyboard Focused + Pressed + Selected.

---

## Tooltip

**Description**

* Brief contextual cue shown on hover/focus.

**When to Use**

* Provide supplemental information where space is limited.
* Clarify purpose of icons/buttons.
* Reveal truncated text.

**When Not to Use**

* Don’t convey critical/required info solely in tooltips.
* No interactive elements within tooltips.

**Best Practices**

* Keep concise and essential.
* Users may miss tooltips; don’t rely on them for critical info.
* Avoid links in tooltips.
* Use consistent visual cues for discoverability.

**Content Guidance**

* 1 sentence (max 2), sentence case with punctuation; be clear and human.

**Options**

* Pointer position: left, right, top, bottom.

---

## Wizard (Full Screen Takeover)

**Description**

* Multi‑step flow for onboarding or creation; full‑screen focused experience with a consistent exit; ideal for complex systems.

**When to Use**

* 2+ steps; focus benefits; complex processes; setup flows; linear steps.

**When Not to Use**

* Dashboards; as a builder replacement (unless entry to one) or when a simpler artifact flow is preferable.

**Best Practices**

* **Progress indication:** Use one of three patterns based on expressiveness: Progress Bar (high), Step Counter/Menu (medium/low), Progress Steps (low).
* **Selection patterns:** Users often choose from options; confirm via primary action.
* **Decision capture:** Early decisions may affect subsequent steps.
* **Content styling:** Use larger Text Lockups; center content sparingly; avoid frequent alignment changes.
* **Form input:** Fewer fields per step for expressive wizards; more fields acceptable for low expressiveness.
* **Multi‑column layout:** Use screen real estate; plan responsiveness carefully.

  * Columns can become separate steps when appropriate.
  * Reflow thoughtfully for 1‑column mobile layouts.
* **Selectable cards:** Suitable for medium/high expressiveness.
* **Chips/Checkboxes:** Use chips in expressive contexts; checkboxes in plainer forms.

**Variants**

* **High Expressiveness:** Color/illustration/motion for simple tasks with big payoff; may use animated backgrounds; ideal when steps are few and payoff is high.
* **Low Expressiveness:** Focus on complex, many‑step processes; users may return over multiple sessions; demands concentration.
* **Progress Bar (High):** Shows rough percentage in bottom bar.
* **Step Counter/Menu (Medium/Low):** Indicates step and allows navigation.
* **Progress Steps (Low):** For >3 steps; particularly when revisiting steps matters.


## Themes and Intents

A theme is a collection of colors, type treatments, and other visual styles that express brand within the context of an application.

### Design themes at GoDaddy

 The GoDaddy family of applications and brands is becoming increasingly diverse. To continually deliver increasing value to our customers, we are expanding product offerings and features.

We have developed a system that enables designers and engineers to deliver these new experiences consistently across all GoDaddy brands and surfaces.

The standard GoDaddy theme is GoDaddy-Antares



### Brand expression

A theme contains all the necessary colors and styles required to express a brand within a certain context. Typically, a theme expresses the brand's default styling. However, a theme can also be used to express a brand during the wintertime, or in a "dark mode", or in Eastern Asia, for example.

When you work with colors and fonts in a design, you are working within a brand's theme.



### Core concepts

This section includes core concepts you should understand as you begin using themes and intents in your GoDaddy designs.

#### Intent

An intent is a declaration of purpose, intended use, or a location. Other systems often refer to these as Design Tokens. Intents are represented as placeholders or variables. A theme determines an intent's value. 

For example, the ux.actionPrimary.backgroundColor intent assigns a value to a primary action’s background color (for example, a primary button). A theme determines the specific value of the background color.

#### Theme

A theme describes visual design attributes (color, size, and so on) and their relationship to intents. In general, themes are tightly coupled with brands. For example, the godaddy:brand theme sets values for intents according to our GoDaddy brand.

#### Theme values

Theme values are closely related to the intents.

In your design, if you want to include a box that sits at a low contrast compared to the page background, the theme knows the treatment to apply to the box background and content.

It's important to think of themes as a system and not necessarily in terms of a specific color (such as Everyday Blue 400 in the GoDaddy palette). To unify our language across GoDaddy and its brands, it is important to think and speak thematically. For example, as applied to the GoDaddy theme, refer to "Passive Text" instead of "Tech Gray 600 Text".

In other themes, "Passive Text" might be an almost-white color, or have a yellow tint. In these cases, everyone working with the theme understands what "passive text" means, even when applied to a different brand.

If you refer to a specific color, such as Tech Gray 600 (passive text in the GoDaddy theme), you are not communicating useful information about the theme or the intent of the style.

#### Theme intent

A theme intent (or theme-level intent) is an abstract, universal category of intents. Each theme must have values assigned to these intents. For example, ux.actionPrimary.* is a theme-level intent designed to cover all primary actions.

#### Local intent

A local intent is maintained “locally” by a shared widget or component. Local intents allow themes to override theme intent values for specific cases. You are not required to use local intents.

For example, like many standard box elements, a modal dialog's background is usually described using ux.box.backgroundColor. In some themes, it might make sense to override that value by setting the value of the more-specific local intent, for example, uxModal.backgroundColor. The local intent in this example provides a way for boxes and modal dialogs to have different styling, even though by default, they share the same background.

If a local intent value is not defined in a theme, the system uses the theme intent value. When you add a local intent to the system, the local intent value must default to a theme intent. Learn more about intents.

## Intents
An intent represents what a Designer intends to convey when applying style. Themes use intents to render the correct color, text style, and other attributes within the context of a brand.


### Overview

Intents convey the meaning of a UI element, and while the meaning of an intent might be the same across GoDaddy UIs, the styling of the element can be different. Strictly speaking, an intent is what a theme value is assigned to.

For example, consider a primary button. In the GoDaddy theme, a primary button is black, and in the Px-pro theme, a primary button is yellow. In both cases, the user interprets the primary button as a call to action, even though the button styling is different between themes.

Think about intents like variable names. The names don't change, but the values do across different brand themes. If (and when) brand themes change, intents provide a lower-cost way to support systematic interface changes to style attributes.


### Example

Intents convey the meaning of a UI element, and while the meaning of an intent might be the same across GoDaddy UIs, the styling of the element can be different. Strictly speaking, an intent is what a theme value is assigned to.

For example, consider a primary button. In the GoDaddy theme, a primary button is black, and in the Px-pro theme, a primary button is yellow. In both cases, the user interprets the primary button as a call to action, even though the button styling is different between themes.

Think about intents like variable names. The names don't change, but the values do across different brand themes. If (and when) brand themes change, intents provide a lower-cost way to support systematic interface changes to style attributes.

### Intent Categories

This section describes the following intent categories:

```text```

```box```

```action```

```navigate```

```control```

```feedback```

```figure```


### text

The text intent describes font properties, including fontFamily, fontSize, lineHeight, and fontWeight.

    text: Describes the body font used in the application. You can think of this as the styles you would normally set on the <body/>.

    textParagraph: Describes the font properties of paragraphs.

    textHeading: Describes the font properties of headings.

    textTitle: Describes the font properties of titles.

    textLabel: Describes the font properties of labels for control components.

    textAction: Describes the font properties of touchable items.

    textInput: Describes the font properties in an area where the user can type.

    textCaption: Describes the font properties of text that is not the primary focus of the component, for example, help text.

 

Example: intents.ux.textTitle.fontSize

 

You do not need to always use text intents directly; instead, you can use the @ux/text component which provides utility classes and React components that relate to the text categories associated with the intents.

 
### box

The box intents are non-interactive elements that separate areas in a UI and contain other components or text. Box intents include the following properties: backgroundColor, foregroundColor, borderColor, outlineColor, and borderRadius.

    box: Describes the style of the body of the application. Think of this as the styles you would normally set on the <body/>.

    boxLowContrast: Describes a style that complements a styled box. This style is low in contrast to the colors of the box. For example, if you set box.backgroundColor to #fff, you might set boxLowContrast.backgroundColor to #ddd.

    boxHighContrast: Describes a style that complements a styled box. This style is high in contrast to the colors of the box. For example, if you set box.backgroundColor to #fff, you might set boxHighContrast.backgroundColor to #111.

    boxLowContrastOverlay: Describes a style that complements a styled box. This style is low in contrast to the colors of the box and meant to appear on top with a slight transparency.

    boxHighContrastOverlay: Describes a style that complements a styled box. This style is high in contrast to the colors of the box and meant to appear on top with a slight transparency.

 

Example: intents.ux.boxLowContrast.backgroundColor

 
### action

The action category describes interactive areas of the UI. There are several different variations, separated by expressions that provide more meaning to the intent.

    action: Describes the style of the general clickable target; a canonical button. You can assume that this does not have a level of hierarchy compared to the primary and secondary intents.

    actionPrimary: Describes the style of the primary clickable target within the application.

    actionSecondary: Describes the style of the secondary clickable target within the application.

    actionControl: Describes the style of the clickable target within a form control.

 

Example: intents.ux.actionPrimary.foregroundColor

The action intents also have interaction modifiers that enable you to change the style based on user interaction. These modifiers include "Hovered", "Focused", and "Chosen". "Chosen" describes both "selected" and "checked".

 
### navigate

The navigate category describes clickable areas of siblings used for navigation with all of the properties of action. These can also include expressions, interactive modifiers, and the textDecoration property that decorates links as navigational items.

    navigate: Describes the style of general clickable navigation item; a canonical link (<a/>). You can assume that this does not have a level of hierarchy compared to the primary and secondary intents.

    navigatePrimary:Describes the style of the primary clickable navigation item within the application.

    navigateSecondary: Describes the style of the secondary clickable navigation item within the application.

 

Example: intents.ux.navigatePrimary.foregroundColor

 
### control

The control category describes areas of the UI meant for interactive user input. Common components include text inputs and checkboxes, but can also include toggle switches and sliders.

Like action category intents, control intents can include expression variations and interaction modifiers, such as interactive boxes for typing or selecting a menu item. The control intent is commonly found in a <form/> and possesses all of the properties of box.

    Control: Describes the style of a general interactive field. This intent is styled like an <input/> tag.

    controlKnob: Describes the style of an interactive control handle, which is found in a toggle and slider.

    controlVoid: Describes the style of non-interactive elements of an interactive field, for example, a placeholder.

 

Example: intents.ux.controlChosenHovered.borderColor

 
### feedback

The feedback category describes areas of the UI that provide a response to the user, such as alerts or error text. Feedback intents are non-interactive.

A feedback box displays an accent based on a state and contains all of the properties of box.

    feedback: Describes a component or part of a component that displays feedback, for example, progress bars. The feedbackColor maps to the accent color of feedback. For example, critical state maps to a red color. This color can map to any color-related CSS property (color, background-color, border-color etc) within the CSS. There is also an associated onFeedbackColor that you can use for the foreground color when you apply feedbackColor as a background color.

    feedbackCritical: Describes a component that is in a "critical" state, which is either error or danger.

    feedbackWarning: Describes a component that is in a "warning" state.

    feedbackSuccess: Describes a component that is in a "success" state.

    feedbackInfo: Describes a component that provides information, which might be different from the accent provided by the default feedback accent.

Each of these intents also includes a high contrast version that you can use when the color should contrast the box color. For example, you can use intents.ux.feedbackHighContrastCritical.feedbackColor for error text.

 

Example: intents.ux.feedbackCritical.feedbackColor
Example: intents.ux.feedbackCritical.onFeedbackColor

 

Note: There are additional feedback intents. The ones listed above are the most common. You can find the complete list below the expressions within feedback.js.


## Layout and Space

The GoDaddy Design System has a robust and simple layout system. Powering the entire thing, we have 4 “t-shirt” sizes that describe the space between things in our UI’s.
These sizes automatically adjust for responsive viewport changes. They are controllable by themes, but are expected to stay relatively similar across themes.

### Spacing Sizes

These values may be applied to padding or gap values in any autolayout frame in Figma, or any box component in production.

We’ll describe these spaces starting with the default, then smallest to largest, so you can see how carefully applying space can help the user draw relationships between design elements.

#### Medium: Default

Medium space is used to signify that things are similar, or generally related to each other. This is a general-purpose gap between most components in a UI. Medium space is like a semicolon; It communicates the end of one thought, to be continued by another related one just after.

For example, use MD space to…

    Separate cards in a gallery or grid

    Separate content from related calls to action

    Create space between input fields in a form

    Pad list items

    Create a gap between a paragraph and a following headline or text lockup.

    Pad smaller, denser cards

#### Small: Content

When you need to show things are more related than using medium space, use small.

Small space is used to separate things that are very closely related. We use small space in type lockups to space the eyebrow, headline and paragraphs from each other. We often find related buttons spaced with SM gaps between them.

For example, use SM space to…

    Separate paragraphs from each other

    Separate buttons from each other in a button lockup

    Separate the bullet from the text in a bulleted list

    Space an icon from nearby related text

#### Large: Containers and Cards

Large Space is typically used for padding on cards. This helps signify unique and less-related content. Choose between MD and LG space for gaps between content and controls within cards.

For example, use LG space to…

    Pad card content

    Separate media elements from content within a card

    Separate buttons from content within a card

#### Extra Large: Layout

Use Extra Large space around and between major content or functionality groupings in your layout. Extra Large space signifies a change in subject.

For example, XL space…

    Goes between the Application Sidebar and everything else in your screen

    Separates the Global Utility Nav from the top and right edge of the viewport, and from the Page Headline

    Separates columns in a multi-column layout

    Separates feeds, grids, and other content from each other

    Creates additional padding around “hero” areas.

### The Box Component
The Box component enables layout system space values to be easily applied to areas in a UI. Boxes are similar to HTML <div> elements in that they may be nested, and are generally used to group content. box provides some additional props to engineers to connect it to our theme and intent system.

### Page Layout
We have several terms to describe different areas of a design. These aren’t special to our system, and they don’t all come with special components. But they do help us to describe things like how our content reflows responsively, or to help us differentiate between global areas and others.

##### Canvas
The main area of your UI design is considered the “content canvas”. This area should should typically have XL space around and between elements. Engineers might call this the “Mount point” for a react application. 

#### Navigators
Primary navigation may exist above or next to the Content Canvas. Navigators help the user move between different areas of GoDaddy, and the surfaces within. Generally, the spacing system applies around navigators as special kinds of content.

#### Content
Distinct content areas on a page need XL space between them. Sidebar and feed columns also get XL space between. The spaces around galleries, grids, and other sections should typically also be XL
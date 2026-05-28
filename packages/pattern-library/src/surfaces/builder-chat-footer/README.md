# BuilderChatFooter

A centered band that sits below a chat composer
(`PromptBox` / `PromptStage`). The single content slot is fully open —
the canonical default is `BuilderChatFooter.Sections`, a
`@godaddy/antares` `SegmentedController` for switching between chat,
media, history, analytics, and settings views inside the chat panel.

```tsx
import {
  BuilderChatFooter,
  DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS,
} from '@airo-ux/pattern-library/surfaces/builder-chat-footer';
import '@airo-ux/pattern-library/surfaces/builder-chat-footer/styles';

<BuilderChatFooter>
  <BuilderChatFooter.Sections
    sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
    defaultActiveSectionId="chat"
    onSectionChange={setSection}
  />
</BuilderChatFooter>
```

## When to use

- Below a chat composer in a builder surface, where the user benefits
  from a single persistent strip that switches between chat-related
  views (history, analytics, settings, etc.) without leaving the chat
  panel.

## When not to use

- For a top-of-page section switcher — use `BuilderHeader.Sections`
  instead. That sits in the page header and addresses app-level
  navigation, not chat-panel-internal switching.
- For a generic surface footer — `FloatingFooter` is the lower-level
  raised sheet primitive. `BuilderChatFooter` is the centered band that
  sits **below** a `FloatingFooter` (as a sibling on the page canvas),
  not inside it. See "Place outside the raised composer surface" under
  Gotchas for the layout rationale.

## Compound parts

`BuilderChatFooter.Sections` — `@godaddy/antares` `SegmentedController`
populated from a `BuilderChatFooterSection[]` (id + label + icon name).
antares owns focus management, keyboard navigation, and the sliding
active indicator. Controlled with `activeSectionId` + `onSectionChange`,
or uncontrolled with `defaultActiveSectionId`. The default section list
exported as `DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS` covers chat / media /
history / analytics / settings.

Pass `collapseInactive={true}` to collapse inactive segments to their
icon, surfacing labels as tooltips on hover/focus. The container reserves
the worst-case label width so the outer footprint stays stable as
selection changes. Default is `false` (all segments fully expanded).

```tsx
<BuilderChatFooter.Sections
  sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
  defaultActiveSectionId="chat"
  collapseInactive
/>
```

## Layout

- The footer is a flex row with `justify-content: center` and
  `align-items: center` — content is centered both horizontally and
  vertically inside the band.
- No padding of its own. The consuming surface (e.g. `FloatingFooter`
  with `blockPadding="sm"` and `gap="sm"`) controls outer spacing
  between the composer and this band.
- `box-sizing: border-box` + `max-inline-size: 100%` keep the band
  inside its parent regardless of any padding the parent applies.

## Accessibility

- The default segmented controller is keyboard-navigable (React Aria
  `ToggleButtonGroup` underneath). Pass `ariaLabel` on
  `BuilderChatFooter.Sections` to localize the group label
  (default: `"Chat panel sections"`).
- Each segment is a `SegmentedControllerItem` — antares handles roles,
  selection state, and focus rings.

## Theme

All visual tokens flow through `@ux/postcss-intents` `intent()` calls
(via `@godaddy/antares` and `@ux/box`). Theme overrides apply
automatically.

## Gotchas

- **Style import is required.** Pair the component import with
  `import '@airo-ux/pattern-library/surfaces/builder-chat-footer/styles';` —
  without it the band loses its width clamps and the segmented
  controller can push its container past the panel edge.
- **Place outside the raised composer surface.** Render the band as a
  sibling **below** the `FloatingFooter`, not inside it. The band has
  no background of its own, so it reads as part of the page canvas
  behind the raised composer card. Putting it inside `FloatingFooter`
  would wrap it in the same elevated chrome and contradict its
  page-level role.
- **Segmented controller handles its own overflow.** When there are
  too many segments to fit, antares scrolls horizontally inside the
  controller. The footer caps the controller at `max-inline-size: 100%`
  with `min-inline-size: 0` so it can shrink to fit; consumers don't
  need to add extra wrappers.
